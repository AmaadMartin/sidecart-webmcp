/**
 * Shopify's real WebMCP tool surface, captured verbatim.
 *
 * These descriptions, schemas and annotations were read from a live Shopify
 * storefront with `document.modelContext.getTools()`. They are reproduced here
 * unedited so the offline harness poses exactly the problem a real store does:
 * ten tools, about 10,500 characters of description and schema, written for
 * large cloud agents rather than for a model running on the device.
 *
 * Nothing here is tuned to make the demo easy. That is the point of it.
 *
 * Captured: Chrome 152, allbirds.com.
 * @see https://shopify.dev/docs/api/web-mcp
 */

export interface ShopifyToolSpec {
  name: string;
  description: string;
  /** JSON Schema, as a string — the form Chrome hands back. */
  inputSchema: string;
  annotations: { readOnlyHint: boolean; untrustedContentHint: boolean };
}

/** The ten tools Shopify registers on every Liquid storefront. */
export const SHOPIFY_TOOLS: ShopifyToolSpec[] = [
  {
    "name": "browse_store",
    "description": "Browse OR navigate to store collections. Set navigate=true whenever the user wants to be taken to a collection page in the browser (triggers: \"browse to\", \"go to\", \"show me\", \"open\", \"take me to\", \"navigate to\" a collection or category). With navigate=false (default), returns collection or product data without changing the page \u2014 use this only when the user is asking a question about the catalog, not asking to view it. Without a collection handle, lists all collections. With a handle, returns products from that collection; use \"all\" to browse everything. Does NOT add anything to the cart; use update_cart for cart changes. Prefer this over search_catalog when the user names a category, collection, or wants to explore. With navigate=true this MOVES the browser to the collection page; the tool result then confirms the destination and instructs you not to navigate again \u2014 follow it.",
    "inputSchema": "{\"type\":\"object\",\"properties\":{\"collection\":{\"type\":\"string\",\"description\":\"Collection handle to browse (e.g. \\\"best-sellers\\\", \\\"new-arrivals\\\"). Omit to list all collections. Use \\\"all\\\" to browse every product.\"},\"navigate\":{\"type\":\"boolean\",\"description\":\"When true, navigate the browser to the collection page after loading data. Set true for user intents like \\\"browse to\\\", \\\"go to\\\", \\\"show me\\\", \\\"open\\\", \\\"take me to\\\" a collection. Requires a collection handle. Defaults to false.\"},\"sort_by\":{\"type\":\"string\",\"description\":\"Sort order. Options: best-selling (default), price-ascending, price-descending, title-ascending, title-descending, created-descending, created-ascending.\"},\"page\":{\"type\":\"number\",\"description\":\"Page number for pagination (starts at 1). Each page returns up to 30 products.\"}}}",
    "annotations": {
      "readOnlyHint": false,
      "untrustedContentHint": true
    }
  },
  {
    "name": "cancel_cart",
    "description": "Remove all items from the cart in one step. Use when the user wants to empty their cart or start over.",
    "inputSchema": "{\"type\":\"object\",\"properties\":{}}",
    "annotations": {
      "readOnlyHint": false,
      "untrustedContentHint": false
    }
  },
  {
    "name": "get_cart",
    "description": "Get the current shopping cart contents \u2014 line items with product titles, variant titles, handles, URLs, images, unit prices, quantities, and totals. Everything needed to describe the cart to the user in natural language, without a follow-up get_product call per line. Works from any page.",
    "inputSchema": "{\"type\":\"object\",\"properties\":{}}",
    "annotations": {
      "readOnlyHint": true,
      "untrustedContentHint": true
    }
  },
  {
    "name": "get_product",
    "description": "Get product details, OR navigate the browser to the product page. Set catalog.navigate=true whenever the user wants to see/view the product in the browser (triggers: \"show me\", \"open\", \"view\", \"go to\", \"take me to\", \"navigate to\" a product). Set catalog.navigate=false (default) only when you need data (description, options, variants, prices, availability) to answer a question or to prepare an update_cart call \u2014 the browser stays on the current page. Defaults to the current page's product if no catalog.id is provided. Does NOT add anything to the cart; use update_cart for that. For a specific variant (color/size/etc.), use show_variant instead \u2014 it accepts partial option selections like \"purple\" without needing every option. With catalog.navigate=true this MOVES the browser to the product page; the tool result then confirms the destination and instructs you not to navigate again \u2014 follow it.",
    "inputSchema": "{\"type\":\"object\",\"properties\":{\"catalog\":{\"type\":\"object\",\"description\":\"Product detail parameters.\",\"properties\":{\"id\":{\"type\":\"string\",\"description\":\"Storefront API Product GID, product handle, or product URL path. Custom app product paths and Shopify standard /products/<handle> paths are supported. The id field from search_catalog or browse_store can be passed directly. If omitted, uses the current page's product.\"},\"navigate\":{\"type\":\"boolean\",\"description\":\"When true, navigate the browser to the product page after fetching details. Set true for user intents like \\\"show me\\\", \\\"open\\\", \\\"view\\\", \\\"go to\\\", \\\"take me to\\\" a product. Defaults to false. If the user specified partial options (e.g. only a color), prefer show_variant with selected_options instead.\"},\"selected_options\":{\"type\":\"array\",\"description\":\"Known product option selections to filter available_options. Use exact option names and values from search_catalog options or a prior get_product available_options entry.\",\"items\":{\"type\":\"object\",\"properties\":{\"name\":{\"type\":\"string\",\"description\":\"Option name, e.g. \\\"Size\\\" or \\\"Color\\\".\"},\"value\":{\"type\":\"string\",\"description\":\"Option value, e.g. \\\"160cm\\\" or \\\"Fiberglass\\\".\"}},\"required\":[\"name\",\"value\"]}}}}}}",
    "annotations": {
      "readOnlyHint": false,
      "untrustedContentHint": true
    }
  },
  {
    "name": "manage_orders",
    "description": "Navigate to the customer's order history page. Use when the user asks about past orders, order status, tracking, or returns. The user will be prompted to log in if not already authenticated. This MOVES the browser to the order history page; the tool result then confirms the destination and instructs you not to navigate again \u2014 follow it.",
    "inputSchema": "{\"type\":\"object\",\"properties\":{}}",
    "annotations": {
      "readOnlyHint": false,
      "untrustedContentHint": false
    }
  },
  {
    "name": "proceed_to_checkout",
    "description": "Proceed to checkout. Verifies the cart is not empty, then MOVES the browser to the checkout page. The tool result then confirms the destination and instructs you not to navigate again \u2014 follow it.",
    "inputSchema": "{\"type\":\"object\",\"properties\":{}}",
    "annotations": {
      "readOnlyHint": false,
      "untrustedContentHint": false
    }
  },
  {
    "name": "search_catalog",
    "description": "Search the store catalog for products, collections, articles, and pages. Does NOT add anything to the cart; use update_cart for cart changes. If the user asks for a specific product variant, call get_product after search_catalog to inspect available variants, then show_variant to display one.",
    "inputSchema": "{\"type\":\"object\",\"required\":[\"catalog\"],\"properties\":{\"catalog\":{\"type\":\"object\",\"required\":[\"query\"],\"properties\":{\"query\":{\"type\":\"string\",\"description\":\"Search query string.\"},\"pagination\":{\"type\":\"object\",\"properties\":{\"limit\":{\"type\":\"integer\",\"description\":\"Max results per type (1-10). Defaults to 5.\",\"default\":5,\"minimum\":1,\"maximum\":10}}}}}}}",
    "annotations": {
      "readOnlyHint": true,
      "untrustedContentHint": true
    }
  },
  {
    "name": "search_shop_policies_and_faqs",
    "description": "Used to get facts about the store's policies, FAQ, or contact details.\nWhen the question is about specific policy kinds, set policy_types to those kinds; leave it unset for general FAQ questions.\nSome examples of questions you can ask are:\n  - What is your return policy? (policy_types: [\"refund\"])\n  - What is your shipping policy? (policy_types: [\"shipping\"])\n  - What is your phone number? (policy_types: [\"contact\"])\n  - What are your hours of operation? (policy_types: [\"contact\"])\n  - Do you offer gift wrapping? (general FAQ, no specific policy kind \u2014 leave policy_types unset)\n",
    "inputSchema": "{\"type\":\"object\",\"properties\":{\"query\":{\"type\":\"string\",\"description\":\"A natural language query. Searches FAQ pages and articles, and routes policies by keyword when policy_types is omitted.\"},\"policy_types\":{\"type\":\"array\",\"description\":\"Policy kinds to fetch, chosen from the user's question \u2014 e.g. [\\\"refund\\\"] for returns/exchanges, [\\\"contact\\\"] for phone/hours/address. Include every kind the question touches. Omit when no specific policy is relevant (e.g. a general FAQ question).\",\"items\":{\"type\":\"string\",\"enum\":[\"refund\",\"shipping\",\"privacy\",\"terms_of_service\",\"terms_of_sale\",\"subscription\",\"legal_notice\",\"contact\"]}}},\"required\":[\"query\"]}",
    "annotations": {
      "readOnlyHint": true,
      "untrustedContentHint": true
    }
  },
  {
    "name": "show_variant",
    "description": "Navigate the browser to a product page, with a specific variant OR a partial option filter selected. Use for view intents: \"show me\", \"open\", \"view\", \"go to\", \"take me to\" a specific product configuration. Accepts EITHER variant_id (fully specified variant) OR selected_options (partial, e.g. only Color=Purple) \u2014 with partial options the first matching available variant is picked automatically, so DO NOT ask the user for missing options when their intent is to view. Does NOT add anything to the cart; use update_cart for cart changes. For cart operations you still need a full variant_id \u2014 call get_product with the full option combination first. This MOVES the browser to the exact variant page with the variant pre-selected; the tool result then confirms the destination and instructs you not to navigate again \u2014 follow it.",
    "inputSchema": "{\"type\":\"object\",\"required\":[\"catalog\"],\"properties\":{\"catalog\":{\"type\":\"object\",\"description\":\"Provide EITHER variant_id OR selected_options. Handle is required unless the user is already on the product page.\",\"properties\":{\"handle\":{\"type\":\"string\",\"description\":\"Product handle. If omitted, uses the current product page's handle.\"},\"variant_id\":{\"type\":[\"string\",\"number\"],\"description\":\"ProductVariant ID from get_product variants[].id, e.g. \\\"gid://shopify/ProductVariant/123\\\", or the numeric variant ID. Use when the user picked a specific fully-specified variant. Omit when using selected_options.\"},\"selected_options\":{\"type\":\"array\",\"description\":\"Partial (or full) option selections, e.g. [{\\\"name\\\":\\\"Color\\\",\\\"value\\\":\\\"Purple\\\"}]. Use when the user names some options but not all (e.g. \\\"show me the purple shoe\\\" \u2014 pass only Color). The first matching available variant will be selected automatically. Use exact option names and values from get_product available_options or search_catalog options.\",\"items\":{\"type\":\"object\",\"properties\":{\"name\":{\"type\":\"string\"},\"value\":{\"type\":\"string\"}}}}}}}}",
    "annotations": {
      "readOnlyHint": false,
      "untrustedContentHint": false
    }
  },
  {
    "name": "update_cart",
    "description": "Add products to the cart, update line item quantities, or remove items. Batch EVERY change for one request into a SINGLE call \u2014 line_items accepts up to 10 entries; do NOT call update_cart once per item. Do NOT retry a call that already returned a result: adds are cumulative, so repeating a call adds duplicate items. Use line_items[].item.id with a ProductVariant GID when the exact variant is known. Use line_items[].id from get_cart to update or remove an existing line, passing the ABSOLUTE target quantity (not a delta; quantity 0 removes the line). Use handle or query only when adding the selected or first available variant.",
    "inputSchema": "{\"type\":\"object\",\"required\":[\"cart\"],\"properties\":{\"cart\":{\"type\":\"object\",\"required\":[\"line_items\"],\"properties\":{\"line_items\":{\"type\":\"array\",\"description\":\"Items to add or update (1-10).\",\"items\":{\"type\":\"object\",\"properties\":{\"id\":{\"type\":\"string\",\"description\":\"Existing cart line id from get_cart. Use to update or remove an existing line. Omit when adding new items.\"},\"item\":{\"type\":\"object\",\"description\":\"The merchandise to add.\",\"properties\":{\"id\":{\"type\":\"string\",\"description\":\"ProductVariant GID from get_product variants[].id, e.g. \\\"gid://shopify/ProductVariant/123\\\".\"}}},\"handle\":{\"type\":\"string\",\"description\":\"Product handle. Adds the selected or first available variant; call get_product first if the user requested specific options.\"},\"query\":{\"type\":\"string\",\"description\":\"Search query to find and add the selected or first available variant. For specific variants, call search_catalog/get_product first and pass item.id.\"},\"quantity\":{\"type\":\"integer\",\"description\":\"Quantity. Defaults to 1 for adds and updates. Set to 0 with an existing line id to remove it.\",\"default\":1}}}}}}}}",
    "annotations": {
      "readOnlyHint": false,
      "untrustedContentHint": false
    }
  }
];
