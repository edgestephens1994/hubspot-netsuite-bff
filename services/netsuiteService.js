import axios from 'axios';
import crypto from 'crypto';
import { log } from '../utils/logger.js';

/**
 * Build OAuth 1.0 signature for NetSuite TBA
 */
function buildOAuthHeader(method, url) {
  const {
    NS_ACCOUNT_ID,
    NS_CONSUMER_KEY,
    NS_CONSUMER_SECRET,
    NS_TOKEN_ID,
    NS_TOKEN_SECRET
  } = process.env;

  const oauthNonce = crypto.randomBytes(16).toString('hex');
  const oauthTimestamp = Math.floor(Date.now() / 1000);

  const parsedUrl = new URL(url);
  const baseUrl = parsedUrl.origin + parsedUrl.pathname; // IMPORTANT: no query parameters

  // OAuth params required by NetSuite
  const params = {
    oauth_consumer_key: NS_CONSUMER_KEY,
    oauth_token: NS_TOKEN_ID,
    oauth_nonce: oauthNonce,
    oauth_timestamp: oauthTimestamp,
    oauth_signature_method: 'HMAC-SHA256',
    oauth_version: '1.0'
  };

  // Alphabetically sorted parameters (MANDATORY for NetSuite)
  const sorted = Object.keys(params)
    .sort()
    .map((key) => `${encodeURIComponent(key)}=${encodeURIComponent(params[key])}`)
    .join('&');

  const baseString =
    method.toUpperCase() +
    '&' +
    encodeURIComponent(baseUrl) +
    '&' +
    encodeURIComponent(sorted);

  const signingKey = `${NS_CONSUMER_SECRET}&${NS_TOKEN_SECRET}`;

  const oauthSignature = crypto
    .createHmac('sha256', signingKey)
    .update(baseString)
    .digest('base64');

  // Final OAuth header (MUST include realm)
  const header =
    `OAuth realm="${NS_ACCOUNT_ID}", ` +
    `oauth_consumer_key="${NS_CONSUMER_KEY}", ` +
    `oauth_token="${NS_TOKEN_ID}", ` +
    `oauth_nonce="${oauthNonce}", ` +
    `oauth_timestamp="${oauthTimestamp}", ` +
    `oauth_signature_method="HMAC-SHA256", ` +
    `oauth_version="1.0", ` +
    `oauth_signature="${encodeURIComponent(oauthSignature)}"`;

  return header;
}

/**
 * POST to NetSuite RESTlet using OAuth 1.0 TBA
 */
async function postToNetSuite(url, payload) {
  if (!url) {
    log('NS RESTlet URL not set — skipping NetSuite call.');
    return;
  }

  const authHeader = buildOAuthHeader('POST', url);

  try {
    const response = await axios.post(url, payload, {
      headers: {
        'Content-Type': 'application/json',
        'Authorization': authHeader,
        'Cookie': 'NS_ROUTING_VERSION=2'
      }
    });

    log('NetSuite RESTlet response:', response.data);
    return response.data;

  } catch (err) {
    if (err.response) {
      log('NetSuite error:', {
        status: err.response.status,
        data: err.response.data
      });
    } else {
      log('NetSuite error:', err.message);
    }
    throw err;
  }
}

/**
 * CREATE CUSTOMER FROM HUBSPOT COMPANY
 */
export async function createCustomerInNS(company) {
  log('Creating Customer in NetSuite:', company.id);

  const payload = {
    hubspotRecord: company
  };

  return postToNetSuite(process.env.NS_RESTLET_CUSTOMER_URL, payload);
}

/**
 * CREATE ITEM FROM HUBSPOT PRODUCT (later)
 */
export async function createItemInNS(product) {
  log('Creating Item in NetSuite:', product.id);

  const payload = {
    hubspotRecord: product
  };

  return postToNetSuite(process.env.NS_RESTLET_ITEM_URL, payload);
}

/**
 * CREATE SALES ORDER FROM HUBSPOT DEAL (later)
 */
export async function createSalesOrderInNS(deal) {
  log('Creating Sales Order in NetSuite:', deal.id);

  const payload = {
    hubspotRecord: deal
  };

  return postToNetSuite(process.env.NS_RESTLET_SALESORDER_URL, payload);
}
