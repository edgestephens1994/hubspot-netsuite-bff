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
  const baseUrl = parsedUrl.origin + parsedUrl.pathname; // remove query params for signature

  // NetSuite requires the base string to EXCLUDE query parameters
  const params = {
    oauth_consumer_key: NS_CONSUMER_KEY,
    oauth_token: NS_TOKEN_ID,
    oauth_nonce: oauthNonce,
    oauth_timestamp: oauthTimestamp,
    oauth_signature_method: 'HMAC-SHA256',
    oauth_version: '1.0'
  };

  // must be lexicographically sorted (NetSuite requirement)
  const sorted = Object.keys(params)
    .sort()
    .map(key => `${encodeURIComponent(key)}=${encodeURIComponent(params[key])}`)
    .join('&');

  // base string format:
  // METHOD & encoded(baseUrl) & encoded(sorted params)
  const baseString =
    method.toUpperCase() +
    '&' +
    encodeURIComponent(baseUrl) +
    '&' +
    encodeURIComponent(sorted);

  // signing key is consumer_secret & token_secret
  const signingKey = `${NS_CONSUMER_SECRET}&${NS_TOKEN_SECRET}`;

  const oauthSignature = crypto
    .createHmac('sha256', signingKey)
    .update(baseString)
    .digest('base64');

  // Final OAuth header (must include realm)
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
