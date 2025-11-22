import { defineHTTPRequest } from "helium/server";

// Example webhook handler for Stripe
export const stripeWebhook = defineHTTPRequest("POST", "/webhooks/stripe", async (req, ctx) => {
    // In a real app, you would:
    // 1. Get the signature from headers
    // const sig = req.headers['stripe-signature'];
    // 2. Verify the signature with Stripe
    // 3. Process the event

    const body = await req.json();

    console.log("[Stripe Webhook] Received event:", body);

    // Example: Handle different event types
    // if (body.type === 'payment_intent.succeeded') {
    //   // Handle successful payment
    // }

    return { received: true };
});

// Example generic webhook
export const genericWebhook = defineHTTPRequest("POST", "/webhooks/generic", async (req, ctx) => {
    const payload = await req.json();

    console.log("[Generic Webhook] Received payload:", payload);

    return {
        status: "success",
        message: "Webhook processed",
    };
});
