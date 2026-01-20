import * as paystackService from "./paystack.service.js";
import * as flutterwaveService from "./flutterwave.service.js";
import * as stripeService from "./stripe.service.js";

/**
 * Payment gateway registry
 * Each gateway must implement:
 * - initializePayment() - Initialize payment with gateway
 * - verifyAndUpdateOrder() - Verify payment and update order
 * - handleWebhook() - Process webhook events
 * - refundPayment() - Process refund ✅ NEW
 * - getRefundStatus() - Get refund status ✅ NEW
 */
const gateways = {
  paystack: paystackService,
  flutterwave: flutterwaveService,
  stripe: stripeService
};

/**
 * Gateway-specific initialization method mapping
 * Each gateway may have different initialization function names
 */
const initializationMethods = {
  paystack: "initializePaystackPayment",
  flutterwave: "initializeFlutterwavePayment",
  stripe: "initializeStripePayment"
};

export const PaymentFactory = {
  /**
   * Get payment service for a specific gateway
   * @param {string} method - Gateway name (paystack, flutterwave, stripe)
   * @returns {Object} Payment service module
   */
  getService(method = "paystack") {
    const normalizedMethod = String(method).toLowerCase();
    const gateway = gateways[normalizedMethod];

    if (!gateway) {
      console.error(`PaymentFactory: Unsupported payment gateway attempted: ${method}`);
      throw new Error(`Unsupported payment gateway: ${method}. Supported gateways: ${Object.keys(gateways).join(", ")}`);
    }

    return gateway;
  },

  /**
   * Get webhook service for a specific provider
   * @param {string} provider - Gateway name (paystack, flutterwave, stripe)
   * @returns {Object|null} Payment service with webhook handler
   */
  getWebhookService(provider = "paystack") {
    const normalized = String(provider).toLowerCase();
    const gateway = gateways[normalized];

    if (!gateway) {
      console.error(`PaymentFactory: Unsupported webhook provider attempted: ${provider}`);
      throw new Error(`Unsupported webhook provider: ${provider}. Supported providers: ${Object.keys(gateways).join(", ")}`);
    }

    if (!gateway.handleWebhook) {
      console.warn(`${provider} service does not implement handleWebhook yet`);
      return null;
    }

    return gateway;
  },

  /**
   * Initialize payment with any gateway
   * @param {string} gateway - Gateway name
   * @param {Object} params - Payment parameters
   * @returns {Promise<Object>} Initialization response
   */
  async initializePayment(gateway, params) {
    const normalized = String(gateway).toLowerCase();
    const service = this.getService(normalized);
    const initMethod = initializationMethods[normalized];

    if (!service[initMethod]) {
      throw new Error(`${gateway} does not support payment initialization`);
    }

    return await service[initMethod](params);
  },

  /**
   * ✅ NEW: Process refund with any gateway
   * @param {string} gateway - Gateway name (paystack, flutterwave, stripe)
   * @param {Object} params - Refund parameters
   * @returns {Promise<Object>} Refund response
   */
  async refundPayment(gateway, params) {
    const normalized = String(gateway).toLowerCase();
    const service = this.getService(normalized);

    if (!service.refundPayment) {
      throw new Error(`${gateway} does not support refund processing`);
    }

    return await service.refundPayment(params);
  },

  /**
   * ✅ NEW: Get refund status from any gateway
   * @param {string} gateway - Gateway name
   * @param {string} refundReference - Refund or transaction reference
   * @returns {Promise<Object>} Refund status
   */
  async getRefundStatus(gateway, refundReference) {
    const normalized = String(gateway).toLowerCase();
    const service = this.getService(normalized);

    if (!service.getRefundStatus) {
      throw new Error(`${gateway} does not support refund status checking`);
    }

    return await service.getRefundStatus(refundReference);
  },

  /**
   * Get list of supported gateways
   * @returns {Array<string>} List of gateway names
   */
  getSupportedGateways() {
    return Object.keys(gateways);
  },

  /**
   * Check if a gateway is supported
   * @param {string} gateway - Gateway name
   * @returns {boolean}
   */
  isSupported(gateway) {
    return Object.keys(gateways).includes(String(gateway).toLowerCase());
  },

  /**
   * Get gateway configuration/requirements
   * @param {string} gateway - Gateway name
   * @returns {Object} Gateway info
   */
  getGatewayInfo(gateway) {
    const normalized = String(gateway).toLowerCase();
    
    const gatewayInfo = {
      paystack: {
        name: "Paystack",
        currencies: ["NGN", "GHS", "ZAR", "USD"],
        countries: ["NG", "GH", "ZA"],
        paymentMethods: ["card", "bank", "ussd", "qr", "mobile_money", "bank_transfer"],
        requiresRedirect: true,
        supportsRefunds: true, // ✅ NEW
        refundMethods: ["full", "partial"], // ✅ NEW
        refundProcessingTime: "3-5 business days" // ✅ NEW
      },
      flutterwave: {
        name: "Flutterwave",
        currencies: ["NGN", "USD", "GBP", "EUR", "GHS", "KES", "ZAR"],
        countries: ["NG", "GH", "KE", "UG", "ZA", "TZ"],
        paymentMethods: ["card", "bank_transfer", "ussd", "mobile_money"],
        requiresRedirect: true,
        supportsRefunds: true, // ✅ NEW
        refundMethods: ["full", "partial"], // ✅ NEW
        refundProcessingTime: "5-7 business days" // ✅ NEW
      },
      stripe: {
        name: "Stripe",
        currencies: ["USD", "EUR", "GBP", "CAD", "AUD"],
        countries: ["US", "GB", "CA", "AU", "EU"],
        paymentMethods: ["card", "bank_transfer", "wallet"],
        requiresRedirect: false, // Uses Stripe Elements/JS
        supportsRefunds: true, // ✅ NEW
        refundMethods: ["full", "partial"], // ✅ NEW
        refundProcessingTime: "5-10 business days" // ✅ NEW
      }
    };

    return gatewayInfo[normalized] || null;
  },

  /**
   * ✅ NEW: Check if a gateway supports refunds
   * @param {string} gateway - Gateway name
   * @returns {boolean}
   */
  supportsRefunds(gateway) {
    const info = this.getGatewayInfo(gateway);
    return info?.supportsRefunds || false;
  },

  /**
   * ✅ NEW: Get refund policy for a gateway
   * @param {string} gateway - Gateway name
   * @returns {Object} Refund policy details
   */
  getRefundPolicy(gateway) {
    const info = this.getGatewayInfo(gateway);
    
    if (!info?.supportsRefunds) {
      return null;
    }

    return {
      gateway: info.name,
      supportedMethods: info.refundMethods,
      processingTime: info.refundProcessingTime,
      maxRefundWindow: "180 days", // Most gateways allow refunds within 6 months
      partialRefundsAllowed: info.refundMethods.includes("partial")
    };
  }
};