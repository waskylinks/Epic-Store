import * as paystackService from "./paystack.service.js";
// other gateways can be added later

const gateways = {
  paystack: paystackService
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
  },

  // Webhook helper
  getWebhookService(provider = "paystack") {
    const normalized = String(provider).toLowerCase();
    const gateway = gateways[normalized];

    if (!gateway) {
      console.error(`PaymentFactory: Unsupported webhook provider attempted: ${provider}`);
      throw new Error(`Unsupported webhook provider: ${provider}`);
    }

    if (!gateway.handleWebhook) {
      console.warn(`${provider} service does not implement handleWebhook yet`);
      return null;
    }

    return gateway;
  }
};
