/**
 * Power BI server-side utilities.
 *
 * Next.js handles Power BI operations natively — Azure AD token
 * acquisition, embed token generation, dataset refresh, and report
 * export are all done via server-side fetch calls to the Power BI REST API.
 *
 * Secrets (tenant ID, client ID, client secret) are kept server-side
 * and never exposed to the client.
 */

import { getSettings } from "@/lib/settings";

const POWERBI_API_BASE = "https://api.powerbi.com/v1.0/myorg";

interface PowerBIEnv {
  tenantId: string;
  clientId: string;
  clientSecret: string;
  workspaceId: string;
  reportId: string;
  datasetId: string;
}

export async function getPowerBIEnv(): Promise<PowerBIEnv> {
  const values = await getSettings([
    "powerbi_tenant_id",
    "powerbi_client_id",
    "powerbi_client_secret",
    "powerbi_workspace_id",
    "powerbi_report_id",
    "powerbi_dataset_id",
  ]);

  if (!values.powerbi_tenant_id || !values.powerbi_client_id || !values.powerbi_client_secret) {
    throw new Error("Missing Power BI credentials");
  }

  return {
    tenantId: values.powerbi_tenant_id,
    clientId: values.powerbi_client_id,
    clientSecret: values.powerbi_client_secret,
    workspaceId: values.powerbi_workspace_id,
    reportId: values.powerbi_report_id,
    datasetId: values.powerbi_dataset_id,
  };
}

/**
 * Acquire an Azure AD access token using the client credentials flow.
 * The token is scoped for Power BI REST API access.
 */
export async function getAzureADToken(): Promise<string> {
  const { tenantId, clientId, clientSecret } = await getPowerBIEnv();

  const tokenUrl = `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`;

  const params = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: clientId,
    client_secret: clientSecret,
    scope: "https://analysis.windows.net/powerbi/api/.default",
  });

  const res = await fetch(tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString(),
  });

  if (!res.ok) {
    const error = await res.text();
    throw new Error(`Azure AD token acquisition failed: ${error}`);
  }

  const data = await res.json();
  return data.access_token as string;
}

export interface PowerBIEmbedConfig {
  embedUrl: string;
  embedToken: string;
  reportId: string;
  expiresAt: string;
}

/**
 * Generate a Power BI embed token and embed URL for a report.
 *
 * @param reportId - Optional report ID. Falls back to POWERBI_REPORT_ID env var.
 * @returns Embed config (URL, token, reportId, expiry)
 */
export async function getEmbedConfig(reportId?: string): Promise<PowerBIEmbedConfig> {
  const env = await getPowerBIEnv();
  const targetReportId = reportId ?? env.reportId;

  if (!targetReportId) {
    throw new Error("No report ID provided and POWERBI_REPORT_ID is not set");
  }

  const accessToken = await getAzureADToken();
  const groupPath = env.workspaceId ? `/groups/${env.workspaceId}` : "";

  // 1. Get report info (embed URL)
  const reportRes = await fetch(
    `${POWERBI_API_BASE}${groupPath}/reports/${targetReportId}`,
    {
      headers: { Authorization: `Bearer ${accessToken}` },
    }
  );

  if (!reportRes.ok) {
    const error = await reportRes.text();
    throw new Error(`Failed to fetch report info: ${error}`);
  }

  const report = await reportRes.json();

  // 2. Generate embed token
  const embedTokenRes = await fetch(
    `${POWERBI_API_BASE}${groupPath}/reports/${targetReportId}/GenerateToken`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        accessLevel: "View",
        allowSaveAs: false,
      }),
    }
  );

  if (!embedTokenRes.ok) {
    const error = await embedTokenRes.text();
    throw new Error(`Failed to generate embed token: ${error}`);
  }

  const embedTokenData = await embedTokenRes.json();

  return {
    embedUrl: report.embedUrl as string,
    embedToken: embedTokenData.token as string,
    reportId: targetReportId,
    expiresAt: embedTokenData.expiration as string,
  };
}

/**
 * Trigger a dataset refresh for a Power BI report's underlying dataset.
 *
 * @param reportId - Optional report ID. Falls back to POWERBI_REPORT_ID env var.
 * @returns Status object
 */
export async function refreshDataset(reportId?: string): Promise<{ status: string }> {
  const env = await getPowerBIEnv();
  const targetReportId = reportId ?? env.reportId;

  if (!targetReportId) {
    throw new Error("No report ID provided and POWERBI_REPORT_ID is not set");
  }

  const accessToken = await getAzureADToken();
  const groupPath = env.workspaceId ? `/groups/${env.workspaceId}` : "";

  // Get the dataset ID from the report
  const reportRes = await fetch(
    `${POWERBI_API_BASE}${groupPath}/reports/${targetReportId}`,
    {
      headers: { Authorization: `Bearer ${accessToken}` },
    }
  );

  if (!reportRes.ok) {
    throw new Error("Failed to fetch report info for refresh");
  }

  const report = await reportRes.json();
  const datasetId = report.datasetId;

  // Trigger dataset refresh
  const refreshRes = await fetch(
    `${POWERBI_API_BASE}${groupPath}/datasets/${datasetId}/refreshes`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        notifyOption: "NoNotification",
      }),
    }
  );

  if (!refreshRes.ok && refreshRes.status !== 202) {
    const error = await refreshRes.text();
    throw new Error(`Failed to trigger dataset refresh: ${error}`);
  }

  return { status: "refresh_triggered" };
}

/**
 * Export a Power BI report to a file format (PDF, PNG, PPTX).
 *
 * @param reportId - Report ID to export
 * @param format - Export format: "PDF" | "PNG" | "PPTX"
 * @param pageName - Optional page name for single-page export
 * @returns Object with download URL or export ID for polling
 */
export async function exportReport(
  reportId: string,
  format: "PDF" | "PNG" | "PPTX",
  pageName?: string
): Promise<{ exportId: string; status: string }> {
  const env = await getPowerBIEnv();
  const accessToken = await getAzureADToken();
  const groupPath = env.workspaceId ? `/groups/${env.workspaceId}` : "";

  const body: Record<string, unknown> = { format };
  if (pageName) {
    body.powerBIReportConfiguration = { pages: [{ pageName }] };
  }

  const exportRes = await fetch(
    `${POWERBI_API_BASE}${groupPath}/reports/${reportId}/ExportTo`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    }
  );

  if (!exportRes.ok) {
    const error = await exportRes.text();
    throw new Error(`Failed to start export: ${error}`);
  }

  const exportData = await exportRes.json();
  return {
    exportId: exportData.id as string,
    status: exportData.status as string,
  };
}
