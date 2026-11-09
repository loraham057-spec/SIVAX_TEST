"use client";

import { useEffect } from "react";

export function usePushSubscription(userId: string | undefined) {
  useEffect(() => {
    if (!userId) return;
    if (!("serviceWorker" in navigator) || !("PushManager" in window)) return;

    const subscribe = async () => {
      try {
        // Request notification permission first
        if (!("Notification" in window)) return;

        let permission = Notification.permission;
        if (permission === "default") {
          permission = await Notification.requestPermission();
        }
        if (permission !== "granted") return;

        // Wait for SW to be ready
        const reg = await navigator.serviceWorker.ready;

        // Check if already subscribed
        let subscription = await reg.pushManager.getSubscription();

        if (!subscription) {
          const vapidPublicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
          if (!vapidPublicKey) {
            console.warn("[push] NEXT_PUBLIC_VAPID_PUBLIC_KEY not set");
            return;
          }

          const convertedKey = urlBase64ToUint8Array(vapidPublicKey);

          subscription = await reg.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: convertedKey as BufferSource,
          });

          console.log("[push] New subscription created:", subscription.endpoint);
        } else {
          console.log("[push] Already subscribed:", subscription.endpoint);
        }

        // Save subscription to server
        const subJson = subscription.toJSON();
        const res = await fetch("/api/push/subscribe", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({
            endpoint: subscription.endpoint,
            keys: {
              p256dh: subJson.keys?.p256dh,
              auth: subJson.keys?.auth,
            },
          }),
        });

        if (res.ok) {
          console.log("[push] Subscription saved to server");
        } else {
          console.error("[push] Failed to save subscription:", await res.text());
        }
      } catch (err) {
        console.error("[push] Subscription error:", err);
      }
    };

    // Delay slightly to ensure SW is registered
    const timer = setTimeout(subscribe, 2000);

    return () => clearTimeout(timer);
  }, [userId]);
}

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}
