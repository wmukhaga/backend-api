const consumerKey = process.env.MPESA_CONSUMER_KEY;
const consumerSecret = process.env.MPESA_CONSUMER_SECRET;
const baseUrl = process.env.MPESA_BASE_URL;
const shortcode = Number(process.env.MPESA_SHORTCODE);
const passkey = process.env.MPESA_PASSKEY;
const callbackUrl = process.env.MPESA_CALLBACK_URL;

// token cache (refresh when expired)
let cachedToken = null;
let tokenExpiry = 0;

async function getToken() {
  if (cachedToken && Date.now() < tokenExpiry) return cachedToken;

  const auth = Buffer.from(`${consumerKey}:${consumerSecret}`).toString("base64");
  const res  = await fetch(
    `${baseUrl}/oauth/v1/generate?grant_type=client_credentials`,
    { headers: { Authorization: `Basic ${auth}` } }
  );

  const data = await res.json();
  if (!data.access_token) throw new Error("Failed to get token: " + JSON.stringify(data));

  cachedToken = data.access_token;
  tokenExpiry = Date.now() + (data.expires_in - 60) * 1000;
  return cachedToken;
}   

// helper: fresh timestamp + password
function getCredentials() {
  const ts = new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 14);
  const password = Buffer.from(`${shortcode}${passkey}${ts}`).toString("base64");
  return { ts, password };
}

// STK push: send a prompt to the user's phone to approve payment
export async function stkpush(bookingId, phoneNumber, amount, reference,) {
  const token    = await getToken();
  const { ts, password } = getCredentials();

  const res = await fetch(`${baseUrl}/mpesa/stkpush/v1/processrequest`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      BusinessShortCode: shortcode,
      Password: password,
      Timestamp: ts,
      TransactionType: "CustomerPayBillOnline",
      Amount: amount,
      PartyA: phoneNumber,
      PartyB: shortcode,
      PhoneNumber: phoneNumber,
      CallBackURL: callbackUrl,
      AccountReference: bookingId.slice(0, 12),
      TransactionDesc: "ticket purchase",
    }),
  });

  return res.json();
}

// STK push query: check the status of a payment request
export async function requestUpdate(checkoutRequestId) {
  const token    = await getToken();
  const { ts, password } = getCredentials();

  const res = await fetch(`${baseUrl}/mpesa/stkpushquery/v1/query`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      BusinessShortCode: shortcode,
      Password: password,
      Timestamp: ts,
      CheckoutRequestID: checkoutRequestId,
    }),
  });

  return res.json();
}   