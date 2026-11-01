import { test, expect, jest } from "@jest/globals";
import { readFileSync } from "node:fs";
import { createContext, SourceTextModule, SyntheticModule } from "node:vm";
import { stripTypeScriptTypes } from "node:module";

const id = "1234567890abcdef12345678";
async function setup() {
  const storage = new Map();
  const cart = { revision: 0, items: [] };
  const api = {
    get: jest.fn(async (path) => ({
      data:
        path === "/users/me"
          ? { user: { id: "buyer" } }
          : structuredClone(cart),
    })),
    put: jest.fn(async (path, value) => {
      if (value.revision !== cart.revision) throw Error("Revision conflict");
      const productId = path.split("/").at(-1);
      const existing = cart.items.find((i) => i.productId === productId);
      if (existing) existing.quantity = value.quantity;
      else cart.items.push({ productId, quantity: value.quantity });
      cart.revision++;
      return { data: structuredClone(cart) };
    }),
  };
  const context = createContext({
    console,
    Event,
    window: new EventTarget(),
    localStorage: {
      getItem: (k) => storage.get(k) || null,
      setItem: (k, v) => storage.set(k, v),
    },
  });
  const code = stripTypeScriptTypes(
    readFileSync("client/src/guest-cart.ts", "utf8"),
  );
  const module = new SourceTextModule(code, { context });
  await module.link(
    async (spec) =>
      new SyntheticModule(
        spec === "react" ? ["useSyncExternalStore"] : ["api"],
        function () {
          this.setExport(
            spec === "react" ? "useSyncExternalStore" : "api",
            spec === "react" ? () => {} : api,
          );
        },
        { context },
      ),
  );
  await module.evaluate();
  return { guest: module.namespace, api, cart, storage };
}
test("guest selections persist, accumulate, and can be removed", async () => {
  const { guest, storage } = await setup();
  guest.addGuestItem(id, 2, 10);
  guest.addGuestItem(id, 1, 10);
  expect(guest.guestItems()[0].quantity).toBe(3);
  expect(storage.size).toBe(1);
  guest.setGuestQuantity(id, 0);
  expect(guest.guestItems()).toHaveLength(0);
});
test("guest cart rejects excessive stock and invalid quantities", async () => {
  const { guest } = await setup();
  expect(() => guest.addGuestItem(id, 4, 3)).toThrow();
  expect(() => guest.setGuestQuantity(id, -1)).toThrow();
  expect(() => guest.setGuestQuantity(id, 1.5)).toThrow();
  expect(guest.guestItems()).toHaveLength(0);
});
test("login merges guest quantities into existing account cart once", async () => {
  const { guest, cart, api } = await setup();
  cart.items = [{ productId: id, quantity: 2 }];
  guest.addGuestItem(id, 3, 10);
  expect(await guest.mergeGuestCart()).toHaveLength(0);
  expect(cart.items[0].quantity).toBe(5);
  expect(guest.guestItems()).toHaveLength(0);
  await guest.mergeGuestCart();
  expect(api.put).toHaveBeenCalledTimes(1);
});
test("failed cart transfers preserve guest selections for retry", async () => {
  const { guest, api } = await setup();
  guest.addGuestItem(id, 2, 10);
  api.put.mockRejectedValue(Error("Stock changed"));
  expect(await guest.mergeGuestCart()).toEqual([id]);
  expect(guest.guestItems()[0].quantity).toBe(2);
});
test("retry recognizes a successful update with a lost response without double adding", async () => {
  const { guest, cart, api } = await setup();
  guest.addGuestItem(id, 2, 10);
  const put = api.put.getMockImplementation();
  api.put.mockImplementationOnce(async (...args) => {
    await put(...args);
    throw Error("Response lost");
  });
  await guest.mergeGuestCart();
  expect(guest.guestItems()).toHaveLength(1);
  await guest.mergeGuestCart();
  expect(cart.items[0].quantity).toBe(2);
  expect(api.put).toHaveBeenCalledTimes(1);
  expect(guest.guestItems()).toHaveLength(0);
});
test("malformed browser data is ignored safely", async () => {
  const { guest, storage } = await setup();
  storage.set("markethub.guest-cart.v1", "bad json");
  expect(guest.guestItems()).toHaveLength(0);
  storage.set(
    "markethub.guest-cart.v1",
    JSON.stringify([
      { productId: id, quantity: 999 },
      { productId: "invalid", quantity: 1 },
    ]),
  );
  expect(guest.guestItems()).toHaveLength(0);
});

test("partial transfer retains only the unavailable selection", async () => {
  const { guest, cart, api } = await setup();
  const second = "2234567890abcdef12345678";
  guest.addGuestItem(id, 2, 10);
  guest.addGuestItem(second, 1, 10);
  api.put.mockRejectedValueOnce(Error("Unavailable"));
  expect(await guest.mergeGuestCart()).toEqual([id]);
  expect(guest.guestItems().map((i) => i.productId)).toEqual([id]);
  expect(cart.items).toEqual([{ productId: second, quantity: 1 }]);
});
test("a full guest cart transfers with one initial cart read", async () => {
  const { guest, cart, api } = await setup();
  for (let i = 0; i < 50; i++)
    guest.addGuestItem(i.toString(16).padStart(24, "0"), 1, 10);
  expect(await guest.mergeGuestCart()).toHaveLength(0);
  expect(cart.items).toHaveLength(50);
  expect(api.get).toHaveBeenCalledTimes(2);
  expect(() => {
    for (let i = 0; i < 51; i++)
      guest.addGuestItem(i.toString(16).padStart(24, "0"), 1, 10);
  }).toThrow("50 products");
});
