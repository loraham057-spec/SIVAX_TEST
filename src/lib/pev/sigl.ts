/**
 * SIGL ESS 2025 (DxDuYrrZSa7): vaccine data elements and the LMIS category
 * option combos synced by the ETL as operands "<DE>.<COC>"
 * (backend/app/etl/sources/dhis2.py — SIGL_VACCINES / SIGL_COCS).
 */

export interface SiglVaccine {
  id: string;
  name: string;
  /** Presentation in RDC (DHIS2 LMIS item name), drives the wastage bound. */
  vial: string;
}

export const SIGL_VACCINES: SiglVaccine[] = [
  { id: "l1bhrYUPsde", name: "BCG", vial: "20 doses, lyophilisé" },
  { id: "uAWIVDnGPGH", name: "Penta", vial: "10 doses, liquide" },
  { id: "hqqlXMmY95c", name: "PCV-13", vial: "4 doses, liquide" },
  { id: "MJrLCya7qzt", name: "Rota", vial: "2 doses, oral" },
  { id: "BCXcLiQNI8M", name: "VPO", vial: "20 doses, gouttes" },
  { id: "IisI6JudbS8", name: "VPI", vial: "5 doses, liquide" },
  { id: "Hjlw6DpooIo", name: "VAR", vial: "10 doses, lyophilisé" },
  { id: "vrTdwvAQSUc", name: "VAA", vial: "10 doses, lyophilisé" },
  { id: "iFMn6ceqdIN", name: "Td", vial: "10 doses, liquide" },
  { id: "RYaAzE1eqya", name: "VAP", vial: "2 doses" },
  { id: "BfoCv6bUeBk", name: "HPV", vial: "1 dose" },
];

export const SIGL_COC = {
  /** Stock disponible utilisable. */
  SDU: "kOWsLrtvrhn",
  /** Consommation moyenne mensuelle. */
  CMM: "t5L9ODSuYOG",
  MAX: "Lpu56KTyGvy",
  ADMINISTERED: "dxDQKDcTn6Z",
  USED: "pdKyvaYRqCj",
  /** Unopened-vial losses (expiry, breakage, freezing). */
  LOSSES: "J8mw9rFkY4v",
} as const;

export const siglOperand = (de: string, coc: string) => `${de}.${coc}`;
