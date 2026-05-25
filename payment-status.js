"use strict";

(function attachDurianPaymentStatus(global) {
  const CART_STORAGE_PREFIX = "durianParadiseCart";
  const PENDING_PAYMENT_STORAGE_PREFIX = "durianParadisePendingPayment";

  function normalizeStatus(value) {
    return String(value || "").trim().toLowerCase();
  }

  function buildStatusPath(sessionId) {
    const normalizedSessionId = String(sessionId || "").trim();
    return `/api/checkout-sessions/${encodeURIComponent(normalizedSessionId)}/status`;
  }

  function clearCheckoutState() {
    const clearMatchingKeys = (storage) => {
      if (!storage) {
        return;
      }

      Object.keys(storage).forEach((key) => {
        if (
          key.startsWith(CART_STORAGE_PREFIX)
          || key.startsWith(PENDING_PAYMENT_STORAGE_PREFIX)
        ) {
          storage.removeItem(key);
        }
      });
    };

    clearMatchingKeys(global.localStorage);
    clearMatchingKeys(global.sessionStorage);
  }

  async function fetchCheckoutSessionStatus(sessionId) {
    const normalizedSessionId = String(sessionId || "").trim();

    if (!normalizedSessionId) {
      throw new Error("Checkout session ID is required.");
    }

    const response = await global.fetch(buildStatusPath(normalizedSessionId), {
      method: "GET",
      headers: {
        Accept: "application/json"
      },
      cache: "no-store"
    });
    const payload = await response.json().catch(() => ({}));
    const paymentStatus = normalizeStatus(
      payload && (payload.paymentStatus || (payload.order && payload.order.paymentStatus))
    );

    return {
      ok: response.ok,
      status: response.status,
      payload,
      paymentStatus,
      isPaid: paymentStatus === "paid"
    };
  }

  async function waitForPaidCheckoutSession(sessionId, options = {}) {
    const attempts = Math.max(1, Number(options.attempts || 1));
    const intervalMs = Math.max(0, Number(options.intervalMs || 0));
    let lastResult = null;

    for (let attempt = 0; attempt < attempts; attempt += 1) {
      try {
        const result = await fetchCheckoutSessionStatus(sessionId);
        lastResult = result;

        if (result.isPaid) {
          return {
            paid: true,
            result
          };
        }
      } catch (error) {
        lastResult = {
          ok: false,
          status: 0,
          payload: {},
          paymentStatus: "",
          isPaid: false,
          error
        };
      }

      if (attempt < attempts - 1 && intervalMs > 0) {
        await new Promise((resolve) => global.setTimeout(resolve, intervalMs));
      }
    }

    return {
      paid: false,
      result: lastResult
    };
  }

  global.DurianPaymentStatus = {
    buildStatusPath,
    clearCheckoutState,
    fetchCheckoutSessionStatus,
    waitForPaidCheckoutSession
  };
})(window);
