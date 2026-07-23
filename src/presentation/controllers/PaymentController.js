import crypto from 'node:crypto';
import { config } from '../../config/env.js';

function sortObject(obj) {
  let sorted = {};
  let str = [];
  for (let key in obj) {
    if (obj.hasOwnProperty(key)) {
      str.push(encodeURIComponent(key));
    }
  }
  str.sort();
  for (let key = 0; key < str.length; key++) {
    sorted[str[key]] = encodeURIComponent(obj[str[key]]).replace(/%20/g, '+');
  }
  return sorted;
}

export class PaymentController {
  constructor(bookingService) {
    this.bookingService = bookingService;
    this.createVNPayUrl = this.createVNPayUrl.bind(this);
    this.vnpayIpn = this.vnpayIpn.bind(this);
  }

  async createVNPayUrl(request, reply) {
    const { amount, orderId, orderInfo } = request.body;

    // Use current timezone for VNPay dates (requires Asia/Ho_Chi_Minh formatting)
    const date = new Date();
    // A simplified formatter to get YYYYMMDDHHmmss without moment.js (assuming local server time is close enough, 
    // but VNPay expects GMT+7. We can adjust offset manually).
    const offset = 7 * 60; // 7 hours in minutes
    const localTime = date.getTime();
    const localOffset = date.getTimezoneOffset() * 60000;
    const gmt7Time = localTime + localOffset + (offset * 60000);
    const gmt7Date = new Date(gmt7Time);

    const pad = (n) => n < 10 ? '0' + n : n;
    const createDate = 
      gmt7Date.getFullYear() +
      pad(gmt7Date.getMonth() + 1) +
      pad(gmt7Date.getDate()) +
      pad(gmt7Date.getHours()) +
      pad(gmt7Date.getMinutes()) +
      pad(gmt7Date.getSeconds());

    const ipAddr = request.ip || '127.0.0.1';

    let vnp_Params = {};
    vnp_Params['vnp_Version'] = '2.1.0';
    vnp_Params['vnp_Command'] = 'pay';
    vnp_Params['vnp_TmnCode'] = config.vnpay.tmnCode;
    vnp_Params['vnp_Locale'] = 'vn';
    vnp_Params['vnp_CurrCode'] = 'VND';
    // Append timestamp to ensure vnp_TxnRef is globally unique for VNPay sandbox
    vnp_Params['vnp_TxnRef'] = `${orderId}_${Date.now()}`;
    vnp_Params['vnp_OrderInfo'] = orderInfo || `Thanh toan don hang ${orderId}`;
    vnp_Params['vnp_OrderType'] = 'other';
    vnp_Params['vnp_Amount'] = amount * 100;
    vnp_Params['vnp_ReturnUrl'] = config.vnpay.returnUrl;
    vnp_Params['vnp_IpAddr'] = ipAddr;
    vnp_Params['vnp_CreateDate'] = createDate;

    // Set expire date to 30 minutes from now to prevent timeout
    const expireTime = new Date(gmt7Time + 30 * 60 * 1000);
    const expireDate =
      expireTime.getFullYear() +
      pad(expireTime.getMonth() + 1) +
      pad(expireTime.getDate()) +
      pad(expireTime.getHours()) +
      pad(expireTime.getMinutes()) +
      pad(expireTime.getSeconds());
    vnp_Params['vnp_ExpireDate'] = expireDate;

    vnp_Params = sortObject(vnp_Params);

    const signData = Object.keys(vnp_Params)
      .map(key => `${key}=${vnp_Params[key]}`)
      .join('&');

    const hmac = crypto.createHmac('sha512', config.vnpay.hashSecret);
    const signed = hmac.update(Buffer.from(signData, 'utf-8')).digest('hex');
    vnp_Params['vnp_SecureHash'] = signed;

    const paymentUrl = config.vnpay.url + '?' + Object.keys(vnp_Params)
      .map(key => `${key}=${vnp_Params[key]}`)
      .join('&');

    reply.send({ paymentUrl, orderId });
  }

  async vnpayIpn(request, reply) {
    let vnp_Params = { ...request.query };
    const secureHash = vnp_Params['vnp_SecureHash'];

    delete vnp_Params['vnp_SecureHash'];
    delete vnp_Params['vnp_SecureHashType'];

    vnp_Params = sortObject(vnp_Params);
    
    const signData = Object.keys(vnp_Params)
      .map(key => `${key}=${vnp_Params[key]}`)
      .join('&');
      
    const hmac = crypto.createHmac('sha512', config.vnpay.hashSecret);
    const signed = hmac.update(Buffer.from(signData, 'utf-8')).digest('hex');

    if (secureHash === signed) {
      const txnRef = vnp_Params['vnp_TxnRef'];
      const orderId = txnRef.includes('_') ? txnRef.split('_')[0] : txnRef;
      const rspCode = vnp_Params['vnp_ResponseCode'];
      const amount = parseInt(vnp_Params['vnp_Amount'], 10) / 100;

      try {
        if (rspCode === '00') {
          // Success
        } else {
          // Failed
        }
        return reply.send({ RspCode: '00', Message: 'Confirm Success' });
      } catch (err) {
        request.log.error(err);
        return reply.send({ RspCode: '99', Message: 'Unknown error' });
      }
    } else {
      return reply.send({ RspCode: '97', Message: 'Invalid signature' });
    }
  }
}
