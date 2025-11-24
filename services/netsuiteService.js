import axios from 'axios';
import crypto from 'crypto';
import { log } from '../utils/logger.js';

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

// HubSpot Deal → NetSuite Sales Order (still POST, placeholder for later)
export async function createSalesOrderInNS(deal) {
  log('Creating Sales Order in NetSuite:', deal.id);

  const payload = {
    hubspotRecord: deal,
  };

  return callNetSuite('POST', process.env.NS_RESTLET_SALESORDER_URL, payload);
}
