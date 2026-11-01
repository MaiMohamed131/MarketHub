import { useSyncExternalStore } from "react";
import { api } from "./api";

const key = "markethub.guest-cart.v1";
const event = "markethub:guest-cart";
type Attempt = { user: string; target: number; revision: number };
export type GuestItem = {
  productId: string;
  quantity: number;
  attempt?: Attempt;
};
let fallback = "[]";
function snapshot() {
  try {
    return localStorage.getItem(key) || fallback;
  } catch {
    return fallback;
  }
}
export function guestItems(): GuestItem[] {
  try {
    const value: unknown = JSON.parse(snapshot());
    if (!Array.isArray(value)) return [];
    return value
      .filter(
        (v): v is GuestItem =>
          v &&
          /^[a-f\d]{24}$/i.test(v.productId) &&
          Number.isInteger(v.quantity) &&
          v.quantity > 0 &&
          v.quantity <= 99,
      )
      .slice(0, 50);
  } catch {
    return [];
  }
}
function write(items: GuestItem[], notify = true) {
  fallback = JSON.stringify(items);
  try {
    localStorage.setItem(key, fallback);
  } catch {
    /* Keep this tab usable if browser storage is unavailable. */
  }
  if (notify) window.dispatchEvent(new Event(event));
}
function subscribe(update: () => void) {
  const changed = (e: StorageEvent) => {
    if (e.key === key || e.key === null) update();
  };
  window.addEventListener(event, update);
  window.addEventListener("storage", changed);
  return () => {
    window.removeEventListener(event, update);
    window.removeEventListener("storage", changed);
  };
}
export const useGuestCartSnapshot = () =>
  useSyncExternalStore(subscribe, snapshot, () => "[]");
export function setGuestQuantity(productId: string, quantity: number) {
  const items = guestItems();
  const found = items.find((i) => i.productId === productId);
  if (!Number.isInteger(quantity) || quantity < 0 || quantity > 99)
    throw Error("Choose a quantity between 1 and 99.");
  if (quantity === 0)
    return write(items.filter((i) => i.productId !== productId));
  if (found) {
    found.quantity = quantity;
    delete found.attempt;
  } else {
    if (items.length >= 50)
      throw Error("Your cart can contain up to 50 products.");
    items.push({ productId, quantity });
  }
  write(items);
}
export function addGuestItem(
  productId: string,
  quantity: number,
  stock: number,
) {
  const total =
    (guestItems().find((i) => i.productId === productId)?.quantity || 0) +
    quantity;
  if (total > stock) throw Error("There isn’t enough stock for that quantity.");
  setGuestQuantity(productId, total);
}

// Keep unmerged items on failure. Record the exact target before writing so a
// retry after a lost response can recognize a successful earlier update.
export async function mergeGuestCart() {
  if (!guestItems().length) return [] as string[];
  const user = (await api.get<{ user: { id: string } }>("/users/me")).data.user;
  const failures: string[] = [];
  type AccountCart = {
    revision: number;
    items: { productId: string; quantity: number }[];
  };
  let cart: AccountCart | undefined;
  for (const item of guestItems()) {
    try {
      cart ??= (await api.get<AccountCart>("/cart")).data;
      const quantity =
        cart.items.find((i) => i.productId === item.productId)?.quantity || 0;
      if (
        item.attempt?.user === user.id &&
        quantity === item.attempt.target &&
        cart.revision > item.attempt.revision
      ) {
        write(
          guestItems().filter((i) => i.productId !== item.productId),
          false,
        );
        continue;
      }
      const target = quantity + item.quantity;
      if (target > 99) throw Error("Quantity exceeds the cart limit.");
      const items = guestItems();
      const current = items.find((i) => i.productId === item.productId);
      if (!current) continue;
      current.attempt = { user: user.id, target, revision: cart.revision };
      write(items, false);
      cart = (
        await api.put<AccountCart>("/cart/items/" + item.productId, {
          quantity: target,
          revision: cart.revision,
        })
      ).data;
      write(
        guestItems().filter((i) => i.productId !== item.productId),
        false,
      );
    } catch {
      cart = undefined;
      failures.push(item.productId);
    }
  }
  window.dispatchEvent(new Event(event));
  return failures;
}
