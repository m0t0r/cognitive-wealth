import {
  DEVICE_COOKIE_MAX_AGE,
  parseDeviceCookie,
  readDeviceCookie,
  setDeviceCookie,
  type DeviceCookieContext,
} from "./device";

const NOW = Date.parse("2026-10-22T12:00:00Z");
const NOW_SECONDS = NOW / 1000;
const PUBLIC_ID = "0192f0c4-0000-7000-8000-000000000001";
// 16 bytes of base64url without padding.
const DEVICE_ID = "AAAAAAAAAAAAAAAAAAAAAA";

const cookie = ({
  publicId = PUBLIC_ID,
  issuedAt = NOW_SECONDS,
  deviceId = DEVICE_ID,
}: { publicId?: string; issuedAt?: number | string; deviceId?: string } = {}) =>
  `${publicId}.${issuedAt}.${deviceId}`;

describe("parseDeviceCookie", () => {
  it("parses a well-formed cookie", () => {
    expect(parseDeviceCookie(cookie({ issuedAt: NOW_SECONDS - 60 }), NOW)).toEqual({
      publicId: PUBLIC_ID,
      issuedAt: NOW_SECONDS - 60,
      deviceId: DEVICE_ID,
    });
  });

  it.for([
    ["no dots", "not-a-device-cookie"],
    ["two parts", `${PUBLIC_ID}.${NOW_SECONDS}`],
    ["an extra part", `${cookie()}.${DEVICE_ID}`],
    ["nothing", ""],
  ])("refuses %s", ([, value]) => {
    expect(parseDeviceCookie(value!, NOW)).toBeNull();
  });

  it("refuses an empty publicId", () => {
    expect(parseDeviceCookie(cookie({ publicId: "" }), NOW)).toBeNull();
  });

  it.for(["soon", "", "-1", "1.5", "1e9", " 1", "1234567890123"])(
    "refuses the issue time %j",
    (issuedAt) => {
      expect(parseDeviceCookie(cookie({ issuedAt }), NOW)).toBeNull();
    },
  );

  it("refuses a cookie from the future, but not one issued this second", () => {
    expect(parseDeviceCookie(cookie({ issuedAt: NOW_SECONDS + 1 }), NOW)).toBeNull();
    expect(parseDeviceCookie(cookie(), NOW)).not.toBeNull();
  });

  it("refuses a cookie older than 180 days, but not one exactly that old", () => {
    const oldest = NOW_SECONDS - DEVICE_COOKIE_MAX_AGE;
    expect(DEVICE_COOKIE_MAX_AGE).toBe(180 * 24 * 60 * 60);
    expect(parseDeviceCookie(cookie({ issuedAt: oldest }), NOW)).not.toBeNull();
    expect(parseDeviceCookie(cookie({ issuedAt: oldest - 1 }), NOW)).toBeNull();
  });

  it.for([
    ["short", "short"],
    ["one character too long", `${DEVICE_ID}A`],
    ["one character too short", DEVICE_ID.slice(1)],
    ["padded", `${DEVICE_ID.slice(2)}==`],
    ["standard base64", `${DEVICE_ID.slice(2)}+/`],
    ["empty", ""],
  ])("refuses a %s device ID", ([, deviceId]) => {
    expect(parseDeviceCookie(cookie({ deviceId: deviceId! }), NOW)).toBeNull();
  });
});

/**
 * The slice of Better Auth's endpoint context the cookie uses. `signed` is what better-call's
 * `getSignedCookie` answers: the verified value, `null` (no cookie or no signature) or `false`
 * (a signature that doesn't verify).
 */
function fakeContext(signed: string | null | false) {
  const getSignedCookie = vi.fn(async (_name: string, _secret: string) => signed);
  const setSignedCookie = vi.fn(
    // oxlint-disable-next-line max-params -- better-call's `setSignedCookie(name, value, secret, attributes)`
    async (_name: string, _value: string, _secret: string, _attributes: unknown) => {},
  );
  const stub = {
    getSignedCookie,
    setSignedCookie,
    context: {
      secret: "test-secret",
      createAuthCookie: (name: string, attributes: Record<string, unknown>) => ({
        name: `cw.${name}`,
        attributes,
      }),
    },
  };
  // A stand-in with only what the cookie functions touch.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  const ctx = stub as unknown as DeviceCookieContext;
  return { ctx, getSignedCookie, setSignedCookie };
}

describe("readDeviceCookie", () => {
  it("reads the signed cookie under its full name with the auth secret", async () => {
    const { ctx, getSignedCookie } = fakeContext(cookie());
    expect(await readDeviceCookie(ctx, NOW)).toEqual({
      publicId: PUBLIC_ID,
      issuedAt: NOW_SECONDS,
      deviceId: DEVICE_ID,
    });
    expect(getSignedCookie).toHaveBeenCalledWith("cw.device", "test-secret");
  });

  it.for([
    ["no cookie or no signature", null],
    ["a signature that doesn't verify", false],
    ["a verified value that doesn't parse", "not-a-device-cookie"],
  ] as const)("is null for %s", async ([, signed]) => {
    expect(await readDeviceCookie(fakeContext(signed).ctx, NOW)).toBeNull();
  });

  it("checks the age against the current time by default", async () => {
    const { ctx } = fakeContext(cookie());
    vi.useFakeTimers({ toFake: ["Date"] });
    onTestFinished(() => {
      vi.useRealTimers();
    });

    vi.setSystemTime(NOW + DEVICE_COOKIE_MAX_AGE * 1000);
    expect(await readDeviceCookie(ctx)).not.toBeNull();
    vi.setSystemTime(NOW + (DEVICE_COOKIE_MAX_AGE + 1) * 1000);
    expect(await readDeviceCookie(ctx)).toBeNull();
  });
});

/** What `setDeviceCookie` signed, with the value parsed back. */
function issued(setSignedCookie: ReturnType<typeof fakeContext>["setSignedCookie"]) {
  const [name, value, secret, attributes] = setSignedCookie.mock.calls[0] ?? [];
  return { name, secret, attributes, parsed: parseDeviceCookie(value ?? "", NOW) };
}

describe("setDeviceCookie", () => {
  it("issues a signed, parseable cookie with a new device ID, scoped to the auth endpoints", async () => {
    const { ctx, setSignedCookie } = fakeContext(null);
    await setDeviceCookie({ ctx, publicId: PUBLIC_ID, now: NOW });

    const { name, secret, attributes, parsed } = issued(setSignedCookie);
    expect(name).toBe("cw.device");
    expect(secret).toBe("test-secret");
    expect(attributes).toEqual({
      path: "/api/auth",
      maxAge: DEVICE_COOKIE_MAX_AGE,
      httpOnly: true,
      sameSite: "lax",
    });
    expect(parsed).toEqual({
      publicId: PUBLIC_ID,
      issuedAt: NOW_SECONDS,
      deviceId: expect.stringMatching(/^[A-Za-z0-9_-]{22}$/),
    });
  });

  it("keeps the device ID of the same user's cookie and renews its issue time", async () => {
    const { ctx, setSignedCookie } = fakeContext(cookie({ issuedAt: NOW_SECONDS - 3600 }));
    await setDeviceCookie({ ctx, publicId: PUBLIC_ID, now: NOW });

    expect(issued(setSignedCookie).parsed).toEqual({
      publicId: PUBLIC_ID,
      issuedAt: NOW_SECONDS,
      deviceId: DEVICE_ID,
    });
  });

  it("gives another user on the same browser a device ID of their own", async () => {
    const { ctx, setSignedCookie } = fakeContext(cookie());
    const other = "0192f0c4-0000-7000-8000-000000000002";
    await setDeviceCookie({ ctx, publicId: other, now: NOW });

    const { parsed } = issued(setSignedCookie);
    expect(parsed?.publicId).toBe(other);
    expect(parsed?.deviceId).not.toBe(DEVICE_ID);
  });

  it.for([
    ["a forged", false],
    ["an expired", cookie({ issuedAt: NOW_SECONDS - DEVICE_COOKIE_MAX_AGE - 1 })],
  ] as const)("doesn't keep the device ID of %s cookie", async ([, signed]) => {
    const { ctx, setSignedCookie } = fakeContext(signed);
    await setDeviceCookie({ ctx, publicId: PUBLIC_ID, now: NOW });
    expect(issued(setSignedCookie).parsed?.deviceId).not.toBe(DEVICE_ID);
  });
});
