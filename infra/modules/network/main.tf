/**
 * Module network — VNet, subnets, NAT Gateway and private DNS.
 *
 * Three properties of this layout matter beyond "it works":
 *
 *  · Fixed egress IP. All outbound traffic leaves through a NAT Gateway with a
 *    static public IP. Today the egress address is whatever the platform hands
 *    out, which means SNIS RDC cannot allow-list us. This is the prerequisite
 *    for asking the ministry for an allow-list entry.
 *
 *  · No public data plane. PostgreSQL, Redis, Key Vault, Storage, ACR and
 *    Azure OpenAI are reached exclusively through private endpoints in
 *    snet-pe, resolved by the private DNS zones declared here. Azure Policy
 *    (module governance) denies public network access on top, so a future
 *    misconfiguration cannot silently expose them.
 *
 *  · The runtime subnet is delegated. Container Apps requires a delegated
 *    subnet; /23 is Microsoft's recommended minimum for a workload-profile
 *    environment and leaves room for scaling.
 */

resource "azurerm_virtual_network" "main" {
  name                = var.names.vnet
  resource_group_name = var.resource_group_name
  location            = var.location
  address_space       = [var.address_space]
  tags                = var.tags
}

# ─── Subnets ───────────────────────────────────────────────

resource "azurerm_subnet" "runtime" {
  name                 = "snet-runtime"
  resource_group_name  = var.resource_group_name
  virtual_network_name = azurerm_virtual_network.main.name
  address_prefixes     = [cidrsubnet(var.address_space, 7, 0)] # /23 out of /16

  delegation {
    name = "container-apps"
    service_delegation {
      name    = "Microsoft.App/environments"
      actions = ["Microsoft.Network/virtualNetworks/subnets/join/action"]
    }
  }
}

# AKS nodes. Deliberately NOT delegated — a delegated subnet cannot host a
# cluster. With Azure CNI Overlay the pods live on their own CIDR outside the
# VNet, so this only has to be large enough for the nodes themselves.
resource "azurerm_subnet" "aks" {
  name                 = "snet-aks"
  resource_group_name  = var.resource_group_name
  virtual_network_name = azurerm_virtual_network.main.name
  address_prefixes     = [cidrsubnet(var.address_space, 7, 2)] # /23
}

resource "azurerm_subnet" "private_endpoints" {
  name                 = "snet-pe"
  resource_group_name  = var.resource_group_name
  virtual_network_name = azurerm_virtual_network.main.name
  address_prefixes     = [cidrsubnet(var.address_space, 8, 2)] # /24
}

resource "azurerm_subnet" "postgres" {
  name                 = "snet-pg"
  resource_group_name  = var.resource_group_name
  virtual_network_name = azurerm_virtual_network.main.name
  address_prefixes     = [cidrsubnet(var.address_space, 8, 3)] # /24

  delegation {
    name = "postgres-flexible"
    service_delegation {
      name    = "Microsoft.DBforPostgreSQL/flexibleServers"
      actions = ["Microsoft.Network/virtualNetworks/subnets/join/action"]
    }
  }
}

# ─── Egress: one stable public IP ──────────────────────────

resource "azurerm_public_ip" "nat" {
  name                = var.names.nat_ip
  resource_group_name = var.resource_group_name
  location            = var.location
  allocation_method   = "Static"
  sku                 = "Standard"
  zones               = var.zone_redundant ? ["1", "2", "3"] : null
  tags                = var.tags
}

resource "azurerm_nat_gateway" "main" {
  name                    = var.names.nat_gateway
  resource_group_name     = var.resource_group_name
  location                = var.location
  sku_name                = "Standard"
  idle_timeout_in_minutes = 10
  tags                    = var.tags
}

resource "azurerm_nat_gateway_public_ip_association" "main" {
  nat_gateway_id       = azurerm_nat_gateway.main.id
  public_ip_address_id = azurerm_public_ip.nat.id
}

# Both runtime subnets egress through the same gateway, so the outbound address
# seen by SNIS RDC is identical whichever orchestrator is selected — switching
# from Container Apps to AKS must not invalidate an allow-list entry.
resource "azurerm_subnet_nat_gateway_association" "runtime" {
  subnet_id      = azurerm_subnet.runtime.id
  nat_gateway_id = azurerm_nat_gateway.main.id
}

resource "azurerm_subnet_nat_gateway_association" "aks" {
  subnet_id      = azurerm_subnet.aks.id
  nat_gateway_id = azurerm_nat_gateway.main.id
}

# ─── Ingress: a stable public IP for the AKS edge ──────────
#
# The AKS ingress load balancer, unlike the Container Apps environment, is
# public. Pre-creating its address here — rather than letting Kubernetes
# allocate one — is what lets Terraform wire the Front Door origin in the same
# apply, with no second pass to read an IP back. The AKS ingress Service adopts
# it by name (Flux substitutes the name), and the cluster identity is granted
# Network Contributor on it in the runtime-aks module.
resource "azurerm_public_ip" "ingress" {
  count               = var.create_ingress_pip ? 1 : 0
  name                = var.names.ingress_ip
  resource_group_name = var.resource_group_name
  location            = var.location
  allocation_method   = "Static"
  sku                 = "Standard"
  zones               = var.zone_redundant ? ["1", "2", "3"] : null
  tags                = var.tags
}

# ─── Network security ──────────────────────────────────────
#
# Inbound is denied outright: the runtime is reached only from Front Door over
# Private Link, which does not traverse this NSG as public traffic. Outbound is
# left open because the ETL must reach SNIS RDC and the assistant must reach the
# LLM provider — both third parties whose address ranges are not stable.

resource "azurerm_network_security_group" "runtime" {
  name                = var.names.nsg_runtime
  resource_group_name = var.resource_group_name
  location            = var.location
  tags                = var.tags

  security_rule {
    name                       = "DenyInternetInbound"
    priority                   = 4000
    direction                  = "Inbound"
    access                     = "Deny"
    protocol                   = "*"
    source_port_range          = "*"
    destination_port_range     = "*"
    source_address_prefix      = "Internet"
    destination_address_prefix = "*"
  }
}

resource "azurerm_subnet_network_security_group_association" "runtime" {
  subnet_id                 = azurerm_subnet.runtime.id
  network_security_group_id = azurerm_network_security_group.runtime.id
}

# The AKS ingress, unlike the Container Apps environment, has a public IP. This
# NSG is the first of the two controls named in k8s/base/ingress.yaml: only
# Azure Front Door's backend addresses may reach the node subnet, so the
# ingress is unreachable from the open internet even though its load balancer
# is public. The second control — nginx verifying the X-Azure-FDID header —
# rejects another tenant's Front Door profile that happened to share the tag.
#
# The default rules are deliberately left in place: VirtualNetwork inbound
# (node-to-node on the overlay) and AzureLoadBalancer inbound (health probes)
# stay allowed; only public traffic that is not Front Door is dropped.
resource "azurerm_network_security_group" "aks" {
  name                = var.names.nsg_aks
  resource_group_name = var.resource_group_name
  location            = var.location
  tags                = var.tags

  # Sans Front Door, ce filtre n'est plus une protection mais une coupure :
  # l'environnement sert alors directement depuis l'IP publique de l'ingress
  # (c'est le cas de dev, où le quota de profils Front Door de l'abonnement est
  # à zéro), et n'autoriser que AzureFrontDoor.Backend fait tomber tout le
  # trafic légitime dans le DenyInternetInbound ci-dessous — load balancer
  # correctement provisionné, pods sains, et pas une requête qui arrive.
  security_rule {
    name                       = var.frontdoor_enabled ? "AllowFrontDoorInbound" : "AllowInternetHttpInbound"
    priority                   = 3000
    direction                  = "Inbound"
    access                     = "Allow"
    protocol                   = "Tcp"
    source_port_range          = "*"
    source_address_prefix      = var.frontdoor_enabled ? "AzureFrontDoor.Backend" : "Internet"
    destination_port_ranges    = ["80", "443"]
    destination_address_prefix = "*"
  }

  # Les sondes de santé du load balancer arrivent de l'infrastructure Azure
  # (168.63.129.16) sur le nodePort du service, pas sur 80/443. Elles tombaient
  # donc dans le DenyInternetInbound ci-dessous, qui précède de loin la règle
  # par défaut AllowAzureLoadBalancerInBound (65001) : priorité 4000 contre
  # 65001, et la première correspondance gagne.
  #
  # Sans sonde qui passe, le load balancer considère tous les nœuds hors
  # service et cesse d'acheminer — DipAvailability et VipAvailability à 0 %.
  # Le symptôme est trompeur : le port répond au SYN, puis plus rien ne
  # revient, alors que l'ingress et l'application sont parfaitement sains.
  security_rule {
    name                       = "AllowAzureLoadBalancerProbes"
    priority                   = 2900
    direction                  = "Inbound"
    access                     = "Allow"
    protocol                   = "*"
    source_port_range          = "*"
    source_address_prefix      = "AzureLoadBalancer"
    destination_port_range     = "*"
    destination_address_prefix = "*"
  }

  security_rule {
    name                       = "DenyInternetInbound"
    priority                   = 4000
    direction                  = "Inbound"
    access                     = "Deny"
    protocol                   = "*"
    source_port_range          = "*"
    source_address_prefix      = "Internet"
    destination_port_range     = "*"
    destination_address_prefix = "*"
  }
}

resource "azurerm_subnet_network_security_group_association" "aks" {
  subnet_id                 = azurerm_subnet.aks.id
  network_security_group_id = azurerm_network_security_group.aks.id
}

# ─── Private DNS ───────────────────────────────────────────
#
# Without these zones a private endpoint resolves to its public name and the
# connection leaves the VNet. One zone per service, each linked to the VNet.

locals {
  private_dns_zones = {
    postgres = "privatelink.postgres.database.azure.com"
    redis    = "privatelink.redis.cache.windows.net"
    keyvault = "privatelink.vaultcore.azure.net"
    blob     = "privatelink.blob.core.windows.net"
    acr      = "privatelink.azurecr.io"
    openai   = "privatelink.openai.azure.com"
  }
}

resource "azurerm_private_dns_zone" "main" {
  for_each            = local.private_dns_zones
  name                = each.value
  resource_group_name = var.resource_group_name
  tags                = var.tags
}

resource "azurerm_private_dns_zone_virtual_network_link" "main" {
  for_each              = azurerm_private_dns_zone.main
  name                  = "link-${each.key}"
  resource_group_name   = var.resource_group_name
  private_dns_zone_name = each.value.name
  virtual_network_id    = azurerm_virtual_network.main.id
  registration_enabled  = false
  tags                  = var.tags
}
