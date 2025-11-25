import axios from 'axios';
import crypto from 'crypto';
import { log } from '../utils/logger.js';

const HUBSPOT_TOKEN = process.env.HUBSPOT_ACCESS_TOKEN;
const HUBSPOT_BASE_URL = 'https://api.hubapi.com';
const CLOSED_WON_STAGE_ID = process.env.HUBSPOT_CLOSED_WON_STAGE_ID || 'closedwon';


/**
 * Build OAuth 1.0a signature using HMAC-SHA256 and including query params.
 */
function buildOAuthHeader(method, fullUrl) {
  const {
    NS_ACCOUNT_ID,
    NS_CONSUMER_KEY,
    NS_CONSUMER_SECRET,
    NS_TOKEN_ID,
    NS_TOKEN_SECRET,
  } = process.env;

  if (
    !NS_ACCOUNT_ID ||
    !NS_CONSUMER_KEY ||
    !NS_CONSUMER_SECRET ||
    !NS_TOKEN_ID ||
    !NS_TOKEN_SECRET
  ) {
    throw new Error('NetSuite TBA environment variables are not fully set');
  }

  method = method.toUpperCase();

  const url = new URL(fullUrl);

  const oauthParams = {
    oauth_consumer_key: NS_CONSUMER_KEY,
    oauth_token: NS_TOKEN_ID,
    oauth_signature_method: 'HMAC-SHA256',
    oauth_timestamp: Math.floor(Date.now() / 1000).toString(),
    oauth_nonce: crypto.randomBytes(16).toString('hex'),
    oauth_version: '1.0',
  };

  const queryParams = Object.fromEntries(url.searchParams);

  const signatureParams = {
    ...oauthParams,
    ...queryParams,
  };

  const sortedParamString = Object.keys(signatureParams)
    .sort()
    .map(
      (key) =>
        `${encodeURIComponent(key)}=${encodeURIComponent(signatureParams[key])}`
    )
    .join('&');

  const baseString =
    method +
    '&' +
    encodeURIComponent(url.origin + url.pathname) +
    '&' +
    encodeURIComponent(sortedParamString);

  const signingKey = `${NS_CONSUMER_SECRET}&${NS_TOKEN_SECRET}`;

  const oauthSignature = crypto
    .createHmac('sha256', signingKey)
    .update(baseString)
    .digest('base64');

  const header =
    `OAuth realm="${NS_ACCOUNT_ID}",` +
    `oauth_consumer_key="${NS_CONSUMER_KEY}",` +
    `oauth_token="${NS_TOKEN_ID}",` +
    `oauth_signature_method="HMAC-SHA256",` +
    `oauth_timestamp="${oauthParams.oauth_timestamp}",` +
    `oauth_nonce="${oauthParams.oauth_nonce}",` +
    `oauth_version="1.0",` +
    `oauth_signature="${encodeURIComponent(oauthSignature)}"`;

  return header;
}

/**
 * Call NetSuite RESTlet with a given HTTP method.
 */
async function callNetSuite(method, url, payload) {
  if (!url) {
    log('NetSuite RESTlet URL not set — skipping NetSuite call.');
    return;
  }

  const authHeader = buildOAuthHeader(method, url);

  try {
    const response = await axios({
      method: method.toLowerCase(),
      url,
      data: payload,
      headers: {
        'Content-Type': 'application/json',
        Authorization: authHeader,
        Cookie: 'NS_ROUTING_VERSION=2',
      },
    });

    log('NetSuite RESTlet response:', response.data);
    return response.data;
  } catch (err) {
    if (err.response) {
      log('NetSuite error:', {
        status: err.response.status,
        data: err.response.data,
      });
    } else {
      log('NetSuite error:', err.message);
    }
    throw err;
  }
}

// HubSpot Company → NetSuite Customer (CREATE)
export async function createCustomerInNS(company) {
  log('Creating Customer in NetSuite (POST):', company.id);

  const payload = {
    hubspotRecord: company,
  };

  return callNetSuite('POST', process.env.NS_RESTLET_CUSTOMER_URL, payload);
}

// HubSpot Company → NetSuite Customer (UPDATE)
export async function updateCustomerInNS(company) {
  log('Updating Customer in NetSuite (PUT):', company.id);

  const payload = {
    hubspotRecord: company,
  };

  return callNetSuite('PUT', process.env.NS_RESTLET_CUSTOMER_URL, payload);
}

// HubSpot Product → NetSuite Item (still POST, placeholder for later)
export async function createItemInNS(product) {
  log('Creating Item in NetSuite:', product.id);

  const payload = {
    hubspotRecord: product,
  };

  return callNetSuite('POST', process.env.NS_RESTLET_ITEM_URL, payload);
}


// Helper: fetch deal associations when they're not present on the deal object
async function fetchDealAssociations(dealId, toObjectType) {
  if (!HUBSPOT_TOKEN) {
    throw new Error('HUBSPOT_ACCESS_TOKEN is not set (fetchDealAssociations)');
  }

  const url = `${HUBSPOT_BASE_URL}/crm/v3/objects/deals/${dealId}/associations/${toObjectType}?limit=100`;

  log(`🔎 Fetching HubSpot deal associations: ${url}`);

  const response = await axios.get(url, {
    headers: {
      Authorization: `Bearer ${HUBSPOT_TOKEN}`,
    },
  });

  const results = response.data.results || [];

  log('📎 Raw association results from HubSpot:', {
    dealId,
    toObjectType,
    results,
  });

  return results;
}

// 🔧 Helper: fetch Product SKU (NetSuite item internal ID) from HubSpot Product
async function fetchProductSku(productId) {
  if (!HUBSPOT_TOKEN) {
    throw new Error('HUBSPOT_ACCESS_TOKEN is not set (fetchProductSku)');
  }

  const url = `${HUBSPOT_BASE_URL}/crm/v3/objects/products/${productId}`;

  log(`🔎 Fetching HubSpot product for SKU mapping: ${url}`);

  const response = await axios.get(url, {
    headers: {
      Authorization: `Bearer ${HUBSPOT_TOKEN}`,
    },
  });

  const props = response.data.properties || {};

  // Candidate property names on the PRODUCT where you might be storing NS item internal ID
  const skuPropCandidates = [
    'item_sku',                            // your custom "item sku field"
    'hs_sku',                              // default HubSpot product SKU
    'sku',                                 // generic
    process.env.HUBSPOT_ITEM_SKU_PROPERTY, // optional override via env var
  ].filter(Boolean);

  let itemInternalId;
  let chosenPropName;

  for (const propName of skuPropCandidates) {
    if (props[propName]) {
      itemInternalId = props[propName];
      chosenPropName = propName;
      break;
    }
  }

  log('📦 Product properties for SKU mapping:', {
    productId,
    props,
    chosenSkuProperty: chosenPropName,
    itemInternalId,
  });

  return { itemInternalId, chosenPropName };
}

// 🔧 Helper: fetch Product description (used as NS item lookup key)
// 🔧 Helper: fetch Product description (used as NS item internal ID)
async function fetchProductIdentifier(productId) {
  if (!HUBSPOT_TOKEN) {
    throw new Error('HUBSPOT_ACCESS_TOKEN is not set (fetchProductIdentifier)');
  }

  const url = `${HUBSPOT_BASE_URL}/crm/v3/objects/products/${productId}`;

  log(`🔎 Fetching HubSpot product for item mapping: ${url}`);

  const response = await axios.get(url, {
    headers: {
      Authorization: `Bearer ${HUBSPOT_TOKEN}`,
    },
  });

  const props = response.data.properties || {};

  // 👇 You promised this will be the NetSuite item internal ID
  const itemInternalId = props.description || null;

  log('📦 Product properties for item mapping:', {
    productId,
    props,
    chosenItemInternalId: itemInternalId,
  });

  return { itemInternalId };
}




// HubSpot Deal → NetSuite Sales Order (still POST, placeholder for later)
// HubSpot Deal → NetSuite Sales Order (POST, full implementation)
// HubSpot Deal → NetSuite Sales Order (POST, full implementation with extra debug)
// HubSpot Deal → NetSuite Sales Order (POST, full implementation with association fallback)
// HubSpot Deal → NetSuite Sales Order (POST, with product lookup for SKU)
// HubSpot Deal → NetSuite Sales Order (POST, using Product description for NS item lookup)
// HubSpot Deal → NetSuite Sales Order (POST, using Product.description as NS item internal ID)
export async function createSalesOrderInNS(deal) {
  log(
    '🔄 createSalesOrderInNS - Raw HubSpot deal object:',
    JSON.stringify(deal, null, 2)
  );

  if (!HUBSPOT_TOKEN) {
    throw new Error('HUBSPOT_ACCESS_TOKEN is not set (netsuiteService)');
  }

  const hubspotDealId = deal.id?.toString();
// ✅ NEW: Only proceed if deal is in Closed Won stage
  const stage = deal.properties?.dealstage;
  if (stage !== CLOSED_WON_STAGE_ID) {
    log('⏭ Skipping NetSuite SO creation – deal is not Closed Won', {
      dealId: hubspotDealId,
      currentStage: stage,
      requiredStage: CLOSED_WON_STAGE_ID,
    });
    return; // do nothing
  }
  // ---------- COMPANY ASSOCIATION ----------
  let hubspotCompanyId = null;

  const associations = deal.associations || {};
  log(
    '🧩 Deal associations object (from deal payload):',
    JSON.stringify(associations, null, 2)
  );

  const embeddedCompanyAssoc =
    associations.companies &&
    associations.companies.results &&
    associations.companies.results[0];

  if (embeddedCompanyAssoc && embeddedCompanyAssoc.id) {
    hubspotCompanyId = embeddedCompanyAssoc.id.toString();
  } else {
    // fallback – explicit associations API, if you already added fetchDealAssociations
    if (typeof fetchDealAssociations === 'function') {
      const companyAssocResults = await fetchDealAssociations(
        hubspotDealId,
        'companies'
      );
      if (companyAssocResults.length > 0) {
        hubspotCompanyId = companyAssocResults[0].id?.toString() || null;
      }
    }
  }

  log('🏢 Extracted company association:', {
    hubspotDealId,
    hubspotCompanyId,
  });

  // ---------- LINE ITEM ASSOCIATIONS ----------
  const lineItems = [];

  let embeddedLineItemAssoc =
    associations.line_items && associations.line_items.results
      ? associations.line_items.results
      : [];

  log(
    '📦 Embedded line_items association results:',
    JSON.stringify(embeddedLineItemAssoc, null, 2)
  );

  // Optional: fallback via associations API if nothing embedded and you have fetchDealAssociations
  if (!embeddedLineItemAssoc.length && typeof fetchDealAssociations === 'function') {
    const lineAssocResults = await fetchDealAssociations(
      hubspotDealId,
      'line_items'
    );
    embeddedLineItemAssoc = lineAssocResults;
    log(
      '📦 line_items association results from API fallback:',
      JSON.stringify(embeddedLineItemAssoc, null, 2)
    );
  }

  const lineItemIds = embeddedLineItemAssoc
    .map((li) => li.id?.toString())
    .filter(Boolean);

  log('📦 Line item IDs resolved for this deal:', lineItemIds);

  // 2) For each line item, fetch the line item + its Product,
  // and use Product.description as the NetSuite item internal ID
  for (const lineItemId of lineItemIds) {
    const url = `${HUBSPOT_BASE_URL}/crm/v3/objects/line_items/${lineItemId}`;

    log('➡️ Fetching HubSpot line item from:', url);

    const liResp = await axios.get(url, {
      headers: {
        Authorization: `Bearer ${HUBSPOT_TOKEN}`,
      },
    });

    const props = liResp.data.properties || {};

    const quantity = parseFloat(props.quantity || '1');
    const rate = parseFloat(props.amount || '0'); // you have amount: '50.00' in logs

    let itemInternalId = null;

    // Use associated Product if present
    if (props.hs_product_id) {
      const productId = props.hs_product_id;
      log('🔁 Using product.description as NS item internal ID:', {
        lineItemId,
        productId,
      });

      const productInfo = await fetchProductIdentifier(productId);
      itemInternalId = productInfo.itemInternalId;
    }

    log('📄 Raw line item properties + derived mapping:', {
      lineItemId,
      props,
      itemInternalId,
      quantity,
      rate,
    });

    if (!itemInternalId) {
      log(
        '⚠️ Line item has no usable product description / NS internal ID; skipping line item.',
        { lineItemId }
      );
      continue;
    }

    lineItems.push({
      itemInternalId,                        // 🔑 numeric string from Product.description
      quantity: isNaN(quantity) ? 1 : quantity,
      rate: isNaN(rate) ? undefined : rate,
      hubspotLineItemId: lineItemId,
    });
  }

  log(
    '✅ Final mapped line items to send to NetSuite:',
    JSON.stringify(lineItems, null, 2)
  );

  if (!hubspotCompanyId) {
    log(
      '❌ No associated company on deal. NS RESTlet will complain about missing hubspotCompanyId.',
      { hubspotDealId }
    );
  }

  if (!lineItems.length) {
    log(
      '❌ No valid line items mapped. NS RESTlet will complain "At least one line item is required".',
      { hubspotDealId }
    );
  }

  const payload = {
    hubspotDealId,
    hubspotCompanyId,
    lineItems,
  };

  log(
    '🚚 Payload being sent to NetSuite Sales Order RESTlet:',
    JSON.stringify(payload, null, 2)
  );

  return callNetSuite('POST', process.env.NS_RESTLET_SALESORDER_URL, payload);
}




