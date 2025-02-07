// Conditionally load dotenv if available (in Node environments that support require)
if (typeof require !== 'undefined') {
  try {
    require('dotenv').config();
  } catch (err) {
    console.warn("dotenv module not available, skipping environment variable loading.", err);
  }
}

// Set the testing flag.
// When true, use local test_data.json for shipment data and process.env for API keys.
const testing = false;
let inputData = {};

// If testing is enabled, use the local test_data.json
if (testing) {
  inputData = require('./test_data.json');
  console.log("Running in testing mode with test_data.json");
} 
// Otherwise, expect shipment data (and keys) to be provided via inputData.mailparser and inputData.API_KEY_...
// (For production, the caller should populate inputData accordingly.)
  
// Define a mapping for stores.
const storeMapping = {
  8636: {
    url: "https://tsastore.mybrightsites.com/",
    // In testing, inputData likely doesn't include API keys so fallback to process.env.
    // In production, inputData is expected to provide the keys.
    apiKey: inputData.API_KEY_8636 || process.env.API_KEY_8636,
    skuPrefix: "TS",
  },
  43379: {
    url: "https://fbla.mybrightsites.com/",
    apiKey: inputData.API_KEY_43379 || process.env.API_KEY_43379,
    skuPrefix: "BL",
  },
  9369: {
    url: "https://fccla.mybrightsites.com/",
    apiKey: inputData.API_KEY_9369 || process.env.API_KEY_9369,
    skuPrefix: "FC",
  },
  // Additional stores can be added here.
};

// Define a mapping for shipping methods.
const shippingMethodsMapping = {
  "UPS RES": "UPS Ground",
  "UPS GRND": "UPS Ground",
  "FedEx GRND": "FedEx Ground",
  "UPS 3DAY": "UPS 3 Day Select",
  // More mappings can be added as required.
};

// Helper function to generate SKU candidate variants.
function getSkuVariants(sku) {
  const parts = sku.trim().split(/[\s-]+/);
  const variants = new Set();
  function generate(index, current) {
    if (index === parts.length - 1) {
      variants.add(current + parts[index]);
      return;
    }
    const separators = ["", " ", "-"];
    for (const sep of separators) {
      generate(index + 1, current + parts[index] + sep);
    }
  }
  if (parts.length) {
    generate(0, "");
  }
  variants.add(sku.trim());
  return Array.from(variants);
}

// Function to look up order details using the store's API.
async function orderLookup(orderId, storeUrl, apiKey) {
  const url = `${storeUrl}api/v2.3.0/orders/${orderId}?token=${apiKey}`;
  const response = await fetch(url, {
    method: "GET",
    redirect: "follow",
    headers: { Accept: "application/json" },
  });
  if (!response.ok) {
    const text = await response.text();
    console.error(`API Request Rejected: URL: ${url}, Status: ${response.status}, Response: ${text}`);
    throw new Error(`orderLookup: Response not ok for orderId ${orderId}, status: ${response.status}`);
  }
  return response.json();
}

// Function to update the order with shipment details.
async function updateOrder(orderId, storeUrl, apiKey, payload, itemId, trackingNumber) {
  const url = `${storeUrl}api/v2.3.0/orders/${orderId}/shipments?token=${apiKey}`;
  const response = await fetch(url, {
    method: "POST",
    redirect: "follow",
    headers: { "Content-Type": "application/json" },
    body: payload,
  });
  if (!response.ok) {
    const text = await response.text();
    console.error(`API Request Rejected:
      URL: ${url}
      Status: ${response.status}
      Payload: ${payload}
      Response: ${text}`);
    throw new Error(`updateOrder: Response not ok for item ${itemId}, tracking: ${trackingNumber}, status: ${response.status}`);
  }
  console.log(`Item Shipping Updated ${itemId} with tracking number ${trackingNumber}`);
}

// Function to process a single shipment.
async function processShipment(shipment) {
  const cleanedCustomerPO = shipment.customer_po.replace(/-S(\d+|#)$/, "");
  if (cleanedCustomerPO.includes("239457") || cleanedCustomerPO.includes("239558")) {
    console.log(`B2B Order: ${cleanedCustomerPO}`);
    return;
  }
  const splitPO = cleanedCustomerPO.split("-");
  let storeId, orderId;
  if (splitPO.length === 2) {
    storeId = splitPO[0];
    orderId = splitPO[1];
  } else if (splitPO.length >= 3) {
    storeId = splitPO[1];
    orderId = splitPO[2];
  } else {
    throw new Error(`processShipment: Invalid customer_po format: ${cleanedCustomerPO}`);
  }
  if (!/^\d+$/.test(storeId)) {
    throw new Error(`processShipment: storeId is not valid (non-digit characters found): ${storeId}`);
  }
  const storeInfo = storeMapping[storeId];
  if (!storeInfo) {
    throw new Error(`processShipment: storeId ${storeId} does not match any stores.`);
  }
  const { url: storeUrl, apiKey } = storeInfo;
  const orderData = await orderLookup(orderId, storeUrl, apiKey);
  if (!orderData.line_items) {
    throw new Error(`processShipment: Invalid order data received for orderId ${orderId}`);
  }
  const mappedShippingMethod =
    shippingMethodsMapping[shipment.ship_via_description] || shipment.ship_via_description;
  const modifiedStockItem = `${storeInfo.skuPrefix}${shipment.stock_item}`;
  const shipmentVariants = getSkuVariants(modifiedStockItem);
  const matchedItems = [];
  for (const itemInOrder of orderData.line_items) {
    const orderSkuVariants = getSkuVariants(itemInOrder.final_sku);
    if (shipmentVariants.some(skuVar => orderSkuVariants.includes(skuVar))) {
      matchedItems.push({
        id: itemInOrder.id,
        quantity: Math.round(Number(shipment.item_qty)),
      });
    }
  }
  if (matchedItems.length === 0) {
    throw new Error(`processShipment: No matching SKU found for shipment with SKU variations: ${shipmentVariants.join(" | ")}`);
  }
  const today = new Date().toISOString().slice(0, 10);
  const updateOrderPayload = JSON.stringify({
    shipment: {
      tracking_number: shipment.tracking_number,
      send_shipping_confirmation: true,
      ship_date: shipment.shipment_date,
      note: `Updated Via Edwards Shipment Doc Through Centricity API on ${today}`,
      shipping_method: mappedShippingMethod,
      line_items: matchedItems,
    },
  });
  await updateOrder(
    orderId,
    storeUrl,
    apiKey,
    updateOrderPayload,
    "bundled",
    shipment.tracking_number
  );
}

// Function that processes all shipments sequentially.
async function processShipments() {
  // Create a Set to store unique error messages (to avoid duplicates).
  const errorSet = new Set();
  let parsedData;

  // When testing mode is enabled, use inputData as-is.
  if (testing) {
    parsedData = inputData;
  } else {
    // Check if inputData.mailparser is defined and is a string before parsing.
    if (typeof inputData.mailparser !== 'string') {
      throw new Error("inputData.mailparser is not defined or not a string. Please provide a valid JSON string in inputData.mailparser.");
    }
    try {
      parsedData = JSON.parse(inputData.mailparser);
    } catch (e) {
      throw new Error(`processShipments: Error parsing inputData.mailparser - ${e.message}`);
    }
  }

  // Ensure that parsedData contains an array of mail attachments (shipment records).
  if (!parsedData.mail_attachments) {
    errorSet.add("processShipments: No mail_attachments found in inputData.");
  } else {
    const shipments = parsedData.mail_attachments;
    // Process each shipment.
    for (const shipment of shipments) {
      try {
        await processShipment(shipment);
      } catch (e) {
        console.error(e);
        errorSet.add(e.message);
      }
    }
  }

  // Aggregate errors if any were encountered.
  if (errorSet.size > 0) {
    const combinedErrorMessage = Array.from(errorSet).join("\n");
    console.error("Accumulated Errors:\n", combinedErrorMessage);
    throw new Error(`processShipments encountered errors:\n${combinedErrorMessage}`);
  }
  return { status: "successfully executed to the end" };
}

// Execute processShipments and rethrow any unhandled errors.
return processShipments().catch(error => {
  throw new Error(`Unhandled error:\n${error.message}`);
});
