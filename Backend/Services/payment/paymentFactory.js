import * as paystackService from "./paystack.service.js";
// import * as flutterwaveService from "./flutterwave.service.js";
// import * as stripeService from "./stripe.service.js";

const gateways = {
  paystack: paystackService,
  // flutterwave: flutterwaveService,
  // stripe: stripeService
};

export const PaymentFactory = {
  getService(method = "paystack") {
    const normalizedMethod = String(method).toLowerCase();
    const gateway = gateways[normalizedMethod];

    if (!gateway) {
      console.error(`PaymentFactory: Unsupported payment gateway attempted: ${method}`);
      throw new Error(`Unsupported payment gateway: ${method}`);
    }

    return gateway;
  }
};
