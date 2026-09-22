const sender = process.env.HOME_VERIFY_OTP_SENDER ?? "no-reply@coinbase.com";

globalThis.fetch = ((input: RequestInfo | URL) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  if (url.startsWith("https://oauth2.googleapis.com/token")) {
    return Response.json({ access_token: "test-access-token" });
  }
  if (url.includes("/users/me/messages/")) {
    return Response.json({
      id: "message-1",
      internalDate: String(Date.now()),
      snippet: "Your sign-in code is 847291",
      payload: { headers: [{ name: "From", value: `Coinbase <${sender}>` }] },
    });
  }
  if (url.includes("/users/me/messages?")) {
    return Response.json({ messages: [{ id: "message-1" }] });
  }
  return Response.json({});
}) as unknown as typeof fetch;
