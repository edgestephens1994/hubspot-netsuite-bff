import axios from 'axios';
import crypto from 'crypto';
import oauth1a from 'oauth-1.0a';
import { log } from '../utils/logger.js';

// Support default / named export depending on bundling
const OAuth = oauth1a.default || oauth1a;

// Create a reusable OAuth 1.0a client (HMAC-SHA256 to match Postman)
function getOAuthClient() {
  const { NS_CONSUMER_KEY, NS_CONSUMER_SECRET } = process.env;

  if (!NS_CONSUMER_KEY || !NS_CONSUMER_SECRET) {
    throw new Error('NetSuite consumer key/secret not set');
  }

  return new OAuth({
    consumer: {
      key: NS_CONSUMER_KEY,
      secret: NS_CONSUMER_SECRET
    },
    signature_method: 'HMAC-SHA256', // IMPORTANT: match Postman
    hash_function(baseString, key) {
      return crypto
        .createHmac('sha256', key)
        .update(baseString)
        .digest('base64');
    }
  });
}

/**
 * Build OAuth 1.0 Authorization header using oauth-1.0a (TBA)
 */
function buildOAuthHeader(method, url) {
  const {
    NS_ACCOUNT_ID,
    NS_TOKEN_ID,
    NS_TOKEN_SECRET
  } = process.env;

  if (!NS_ACCOUNT_ID || !NS_TOKEN_ID || !NS_TOKEN_SECRET) {
    throw new Error('NetSuite TBA environment variables not fully set');
  }

  const oauth = getOAuthClient();

  const requestData = {
    url,
    method: method.toUpperCase()
    // oauth-1.0a will include query params (script, deploy, etc.) from the URL
  };

  const token = {
    key: NS_TOKEN_ID,
    secret: NS_TOKEN_SECRET
  };

  const authParams = oauth.authorize(requestData, token);

  // NetSuite requires realm in the header
  const headerParams = {
    realm: NS_ACCOUNT_ID,
    ...authParams
  };

  const header =
    'OAuth ' +
    Object.keys(headerParams)
      .sort()
      .map(
        (key) =>
          `${encodeURIComponent(key)}="${encodeURIComponent(headerParams[key])}"`
      )
      .join(', ');

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

// HubSpot Company → NetSuite Customer
export async function createCustomerInNS(company) {
  log('Creating Customer in NetSuite:', company.id);

  const payload = {
    hubspotRecord: company
  };

  return postToNetSuite(process.env.NS_RESTLET_CUSTOMER_URL, payload);
}

// HubSpot Product → NetSuite Item (later)
export async function createItemInNS(product) {
  log('Creating Item in NetSuite:', product.id);

  const payload = {
    hubspotRecord: product
  };

  return postToNetSuite(process.env.NS_RESTLET_ITEM_URL, payload);
}

// HubSpot Deal → NetSuite Sales Order (later)
export async function createSalesOrderInNS(deal) {
  log('Creating Sales Order in NetSuite:', deal.id);

  const payload = {
    hubspotRecord: deal
  };

  return postToNetSuite(process.env.NS_RESTLET_SALESORDER_URL, payload);
}
