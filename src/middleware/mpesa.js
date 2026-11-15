const consumerKey = process.env.MPESA_CONSUMER_KEY;
const consumerSecret = process.env.MPESA_CONSUMER_SECRET;
const auth = Buffer.from(`${consumerKey}:${consumerSecret}`).toString('base64');
const baseUrl = process.env.MPESA_BASE_URL;
const shortcode = Number(process.env.MPESA_SHORTCODE);
const callbackUrl = process.env.MPESA_CALLBACK_URL;

const timestamp = new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14);
const password = Buffer.from(`${process.env.MPESA_SHORTCODE}${process.env.MPESA_PASSKEY}${timestamp}`).toString('base64');


// auth exchange middleware
export const authExchange = await fetch(
    `${baseUrl}/oauth/v1/generate?grant_type=client_credentials`,
    {
        headers: {
            Authorization: `Basic ${auth}`
        },
    }
);
export const {access_token, expires_in} = await authExchange.json();

// STK push request middleware
export async function stkpush(bookingId, phoneNumber, amount, reference, description) {
  const ts = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14);
  const password = Buffer.from(`${shortcode}${passkey}${ts}`).toString("base64");

  const res = await fetch(
    `${baseUrl}/mpesa/stkpush/v1/processrequest`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${access_token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        BusinessShortCode: shortcode,
        Password: password,
        Timestamp: ts,
        TransactionType: "CustomerBuyGoodsOnline",
        Amount: amount,
        PartyA: phoneNumber,
        PartyB: shortcode,
        PhoneNumber: phoneNumber,
        CallBackURL: callbackUrl,
        AccountReference: bookingId,
        TransactionDesc: description,
      }),
    }
  );

  return res.json();
}   


// STK push request update query request middleware
export async function requestUpdate(request_id) {
  const res = await fetch(
    `${baseUrl}/mpesa/stkpush/v1/query`,
    {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${access_token}`,
            'Content-Type': 'application/json'
        },  
        body: JSON.stringify({ 
            BusinessShortCode: shortcode,
            Password: password,
            Timestamp: timestamp,
            CheckoutRequestID: request_id
        })
    }
);
    return res.json();
};

