import axios from "axios";
import { useQuery } from "@tanstack/react-query";
export type Category = {
  _id: string;
  name: string;
  slug: string;
  description: string;
  image: string;
};
export type Product = {
  _id: string;
  name: string;
  description: string;
  price: number;
  brand?: string;
  originalPrice?: number;
  demoKey?: string;
  specifications?: Record<string, string>;
  currency: string;
  stock: number;
  category: string | Category;
  storeName: string;
  images: string[];
  averageRating: number;
  reviewCount: number;
};
export type Listing = {
  products: Product[];
  pagination: { page: number; pages: number; total: number; limit: number };
};
export const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || "/api",
  withCredentials: true,
  timeout: 10000,
});
export const useCategories = () =>
  useQuery({
    queryKey: ["categories"],
    queryFn: async ({ signal }) =>
      (await api.get<{ categories: Category[] }>("/categories", { signal }))
        .data.categories,
  });
export const useProducts = (params: string) =>
  useQuery({
    queryKey: ["products", params],
    queryFn: async ({ signal }) =>
      (await api.get<Listing>("/products?" + params, { signal })).data,
  });
export const useProduct = (id: string) =>
  useQuery({
    queryKey: ["product", id],
    queryFn: async ({ signal }) =>
      (
        await api.get<{ product: Product; related: Product[] }>(
          "/products/" + encodeURIComponent(id),
          { signal },
        )
      ).data,
    retry: false,
  });
export const money = (value: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(
    value / 100,
  );

let accessToken = "";
let refreshing: Promise<void> | null = null;
export function setAccessToken(value: string) {
  accessToken = value;
}
api.interceptors.request.use((config) => {
  if (accessToken) config.headers.Authorization = "Bearer " + accessToken;
  return config;
});
api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const config = error.config;
    if (
      config &&
      error.response?.status === 401 &&
      !config._retried &&
      !config.url?.startsWith("/auth/")
    ) {
      config._retried = true;
      try {
        refreshing ??= api
          .post("/auth/refresh")
          .then((r) => {
            setAccessToken(r.data.accessToken);
          })
          .finally(() => {
            refreshing = null;
          });
        await refreshing;
        return api.request(config);
      } catch {
        setAccessToken("");
      }
    }
    return Promise.reject(error);
  },
);
