import axios from 'axios';
import crypto from 'crypto';
import { log } from '../utils/logger.js';

const HUBSPOT_TOKEN = process.env.HUBSPOT_ACCESS_TOKEN;
const HUBSPOT_BASE_URL = 'https://api.hubapi.com';


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


// HubSpot Deal → NetSuite Sales Order (still POST, placeholder for later)
// HubSpot Deal → NetSuite Sales Order (POST, full implementation)
// HubSpot Deal → NetSuite Sales Order (POST, full implementation with extra debug)
// HubSpot Deal → NetSuite Sales Order (POST, full implementation with association fallback)
export async function createSalesOrderInNS(deal) {
  log(
    '🔄 createSalesOrderInNS - Raw HubSpot deal object:',
    JSON.stringify(deal, null, 2)
  );

  if (!HUBSPOT_TOKEN) {
    throw new Error('HUBSPOT_ACCESS_TOKEN is not set (netsuiteService)');
  }

  // 1) Deal ID
  const hubspotDealId = deal.id?.toString();

  // ---- COMPANY ASSOCIATION ----
  let hubspotCompanyId = null;

  // a) Try embedded associations first
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
    // b) Fallback: call associations API
    const companyAssocResults = await fetchDealAssociations(
      hubspotDealId,
      'companies'
    );

    if (companyAssocResults.length > 0) {
      // v3 associations response: [{ id, type }]
      hubspotCompanyId = companyAssocResults[0].id?.toString() || null;
    }
  }

  log('🏢 Extracted company association:', {
    hubspotDealId,
    hubspotCompanyId,
  });

  // ---- LINE ITEM ASSOCIATIONS ----
  const lineItems = [];

  // a) Try embedded line_items first
  let embeddedLineItemAssoc =
    associations.line_items && associations.line_items.results
      ? associations.line_items.results
      : [];

  log(
    '📦 Embedded line_items association results:',
    JSON.stringify(embeddedLineItemAssoc, null, 2)
  );

  // b) If no embedded line_items, call associations API
  if (!embeddedLineItemAssoc.length) {
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

  // Extract IDs from association results (both shapes use "id")
  const lineItemIds = embeddedLineItemAssoc
    .map((li) => li.id?.toString())
    .filter(Boolean);

  log('📦 Line item IDs resolved for this deal:', lineItemIds);

  // Candidate property names for "item internal id" on the line item
  const skuPropCandidates = [
    'item_sku',                            // likely custom "item sku field"
    'hs_sku',                              // default HubSpot SKU property
    'sku',                                 // generic
    process.env.HUBSPOT_ITEM_SKU_PROPERTY, // optional override via env var
  ].filter(Boolean);

  // 2) Fetch each line item to get SKU, qty, price
  for (const lineItemId of lineItemIds) {
    const url = `${HUBSPOT_BASE_URL}/crm/v3/objects/line_items/${lineItemId}`;

    log('➡️ Fetching HubSpot line item from:', url);

    const liResp = await axios.get(url, {
      headers: {
        Authorization: `Bearer ${HUBSPOT_TOKEN}`,
      },
    });

    const props = liResp.data.properties || {};

    // Try multiple property names for the NS item internal ID
    let itemInternalId;
    let chosenPropName;

    for (const propName of skuPropCandidates) {
      if (props[propName]) {
        itemInternalId = props[propName];
        chosenPropName = propName;
        break;
      }
    }

    const quantity = parseFloat(props.quantity || '1');
    const rate = parseFloat(props.price || '0');

    log('📄 Raw line item properties + derived mapping:', {
      lineItemId,
      props,
      chosenSkuProperty: chosenPropName,
      itemInternalId,
      quantity,
      rate,
    });

    if (!itemInternalId) {
      log(
        '⚠️ Line item missing any usable SKU property; cannot determine NS item internal ID. Skipping line item.',
        { lineItemId, skuPropCandidates }
      );
      continue;
    }

    lineItems.push({
      itemInternalId,
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

  // 3) Payload for NetSuite RESTlet (what the RESTlet expects)
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

