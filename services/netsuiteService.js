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

  const params = {
    oauth_consumer_key: NS_CONSUMER_KEY,
    oauth_token: NS_TOKEN_ID,
    oauth_nonce: oauthNonce,
    oauth_timestamp: oauthTimestamp,
    oauth_signature_method: 'HMAC-SHA256',
    oauth_version: '1.0'
  };

  const baseString =
    method.toUpperCase() +
    '&' +
    encodeURIComponent(url) +
    '&' +
    encodeURIComponent(
      Object.keys(params)
        .sort()
        .map((k) => `${k}=${params[k]}`)
        .join('&')
    );

  const signingKey =
    `${NS_CONSUMER_SECRET}&${NS_TOKEN_SECRET}`;

  const signature = crypto
    .createHmac('sha256', signingKey)
    .update(baseString)
    .digest('base64');

  const header =
    `OAuth ` +
    `oauth_consumer_key="${NS_CONSUMER_KEY}", ` +
    `oauth_token="${NS_TOKEN_ID}", ` +
    `oauth_nonce="${oauthNonce}", ` +
    `oauth_timestamp="${oauthTimestamp}", ` +
    `oauth_signature_method="HMAC-SHA256", ` +
    `oauth_version="1.0", ` +
    `oauth_signature="${encodeURIComponent(signature)}"`;

  return header;
}

/**
 * POST to NetSuite RESTlet using OAuth 1.0 TBA
 */
async function postToNetSuite(url, payload) {
  if (!url) {
    log('NS_RESTLET_CUSTOMER_URL not set — skipping NS call.');
    return;
  }

  const authHeader = buildOAuthHeader('POST', url);

  try {
    const response = await axios.post(url, payload, {
      headers: {
        'Content-Type': 'application/json',
        'Authorization': authHeader,
        'Cookie': `NS_ROUTING_VERSION=2` // required by some accounts
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

// HubSpot Company → NetSuite Customer
export async function createCustomerInNS(company) {
  log('Creating Customer in NetSuite:', company.id);

  const payload = {
    hubspotRecord: company
  };

  return postToNetSuite(process.env.NS_RESTLET_CUSTOMER_URL, payload);
}

// HubSpot Product → Item (later)
export async function createItemInNS(product) {
  log('Creating Item in NetSuite:', product.id);
  const payload = { hubspotRecord: product };
  return postToNetSuite(process.env.NS_RESTLET_ITEM_URL, payload);
}

// HubSpot Deal → Sales Order (later)
export async function createSalesOrderInNS(deal) {
  log('Creating Sales Order in NetSuite:', deal.id);
  const payload = { hubspotRecord: deal };
  return postToNetSuite(process.env.NS_RESTLET_SALESORDER_URL, payload);
}
