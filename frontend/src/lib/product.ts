/**
 * The product's name, in one place. The name is being replaced
 * (omnipost.in belongs to another product), so set VITE_PRODUCT_NAME in
 * frontend/.env (and PRODUCT_NAME in backend/.env, for emails) and rebuild.
 *
 * Internal keys that merely contain the old name (localStorage keys, the
 * auth lock name) deliberately stay as they are: changing them would make
 * every browser forget saved choices.
 */
export const PRODUCT_NAME: string = import.meta.env.VITE_PRODUCT_NAME?.trim() || "OmniPost";

/** The letter in the square logo mark. */
export const PRODUCT_INITIAL: string = PRODUCT_NAME.charAt(0).toUpperCase();
