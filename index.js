require('dotenv').config();

const testing = 'false';
let inputData = {};

if (testing) {
  inputData = require('./test_data.json');
  console.log("Running in testing mode with test_data.json");
}

// Store mapping remains the same.
const storeMapping = {
  7400: {
    url: "https://fbla.mybrightsites.com/",
    apiKey: process.env.API_KEY_7400,
  },
  8636: {
    url: "https://tsastore.mybrightsites.com/",
    apiKey: process.env.API_KEY_8636,
  },
  43379: {
    url: "https://fbla.mybrightsites.com/",
    apiKey: process.env.API_KEY_43379,
  },
  9369: {
    url: "https://fccla.mybrightsites.com/",
    apiKey: process.env.API_KEY_9369,
  },
  // 12345: {
  //   url: "https://subdomain.mybrightsites.com",
  //   apiKey: process.env.API_KEY_12345,
  // },
};

// Add your shipping methods mapping.
const shippingMethodsMapping = {
  "UPS RES": "UPS Ground",
  "UPS GRND": "UPS Ground",
  "FedEx GRND": "FedEx Ground",
  "UPS 3DAY": "UPS 3 Day Select",
  // add more mappings as needed
};

// Helper: Generate SKU candidate variants by splitting on spaces and dashes,
// then joining the parts in different ways.
function getSkuVariants(sku) {
  const parts = sku.trim().split(/[\s-]+/);
  const variants = new Set();
  
  // Recursive helper to generate all variants.
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
  
  // Ensure the original trimmed SKU is also included.
  variants.add(sku.trim());
  return Array.from(variants);
}

// Look up order details.
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
    throw new Error(
      `orderLookup: Response not ok for orderId ${orderId}, status: ${response.status}`
    );
  }
  return response.json();
}

// Update the order with shipment details.
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
    throw new Error(
      `updateOrder: Response not ok for item ${itemId}, tracking: ${trackingNumber}, status: ${response.status}`
    );
  }
  console.log(`Item Shipping Updated ${itemId} with tracking number ${trackingNumber}`);
}

// Process a single shipment.
async function processShipment(shipment) {
  // Remove trailing "-S1", "-S2", "-S3", or "-S#" from customer_po.
  const cleanedCustomerPO = shipment.customer_po.replace(/-S(\d+|#)$/, "");

  // Check if the cleaned customer_po contains "239457" and skip processing if so.
  if (cleanedCustomerPO.includes("239457")) {
    console.log(`B2B Order: ${cleanedCustomerPO}`);
    return;
  }

  // Split the cleaned customer PO.
  const splitPO = cleanedCustomerPO.split("-");
  let storeId, orderId;
  if (splitPO.length === 2) {
    // If exactly 2 parts, treat first as storeId and second as orderId.
    storeId = splitPO[0];
    orderId = splitPO[1];
  } else if (splitPO.length >= 3) {
    // If 3 or more parts, ignore the first (store abbreviation) and use the next two.
    storeId = splitPO[1];
    orderId = splitPO[2];
  } else {
    throw new Error(
      `processShipment: Invalid customer_po format: ${cleanedCustomerPO}`
    );
  }

  // Add "TS" to the incoming SKU before generating variants.
  const modifiedStockItem = `TS${shipment.stock_item}`;
  // Generate candidate SKU variants for the modified shipment SKU.
  const shipmentVariants = getSkuVariants(modifiedStockItem);

  // Validate storeId is numeric.
  if (!/^\d+$/.test(storeId)) {
    throw new Error(
      `processShipment: storeId is not valid (non-digit characters found): ${storeId}`
    );
  }

  const storeInfo = storeMapping[storeId];
  if (!storeInfo) {
    throw new Error(
      `processShipment: storeId ${storeId} does not match any stores.`
    );
  }
  const { url: storeUrl, apiKey } = storeInfo;

  // Look up order details.
  const orderData = await orderLookup(orderId, storeUrl, apiKey);
  if (!orderData.line_items) {
    throw new Error(
      `processShipment: Invalid order data received for orderId ${orderId}`
    );
  }

  // Map incoming shipping_method to your internal shipping method.
  const mappedShippingMethod =
    shippingMethodsMapping[shipment.ship_via_description] ||
    shipment.ship_via_description;

  // Accumulate matching items so they can be bundled in one request.
  const matchedItems = [];
  for (const itemInOrder of orderData.line_items) {
    const orderSkuVariants = getSkuVariants(itemInOrder.final_sku);
    // Check if any variant of the shipment SKU matches any variant of the order SKU.
    const found = shipmentVariants.some(skuVar => orderSkuVariants.includes(skuVar));
    if (found) {
      matchedItems.push({
        id: itemInOrder.id,
        quantity: Math.round(Number(shipment.item_qty)),
      });
    }
  }
  if (matchedItems.length === 0) {
    throw new Error(
      `processShipment: No matching SKU found for shipment with SKU variations: ${shipmentVariants.join(" | ")}`
    );
  }
  
  // After accumulating matching items into the "matchedItems" array,
  // we create a payload to update the related order with shipping details.
  const updateOrderPayload = JSON.stringify({
    shipment: {
      // The tracking number for the shipment
      tracking_number: shipment.tracking_number,
      // Flag to indicate that a shipping confirmation should be sent
      send_shipping_confirmation: true,
      // The date the shipment occurred
      ship_date: shipment.shipment_date,
      // A note detailing how this update was performed
      note: "Updated Via Edwards Shipment Doc Through Centricity API",
      // The converted shipping method (mapped from the incoming value)
      shipping_method: mappedShippingMethod,
      // The list of all matching order items that share the same shipment (bundled together)
      line_items: matchedItems,
    },
  });

  // The updateOrder function is called once per shipment
  // (or per distinct tracking_number) to update multiple order items at once.
  // The "bundled" identifier here indicates that multiple items have been combined
  // into a single request.
  await updateOrder(
    orderId,            // The order ID to update
    storeUrl,           // The store URL from storeMapping (includes API endpoint)
    apiKey,             // The API key for authentication
    updateOrderPayload, // The payload containing shipment details and line_items
    "bundled",          // An identifier used for logging (indicates bundled items)
    shipment.tracking_number // The tracking number for further logging/debugging
  );
}

// Process all shipments sequentially and accumulate errors.
async function processShipments() {
  // Create a Set to store unique error messages to avoid duplication.
  const errorSet = new Set();
  let parsedData;

  // When testing mode is activated, we assume the test_data.json is already an object,
  // otherwise, we try to parse the 'mailparser' property of the input data.
  if (testing) {
    parsedData = inputData;
  } else {
    try {
      parsedData = JSON.parse(inputData.mailparser);
    } catch (e) {
      // If JSON parsing fails, throw an error with details.
      throw new Error(`processShipments: Error parsing inputData.mailparser - ${e.message}`);
    }
  }

  // Check if the parsed data contains the 'mail_attachments' property,
  // which holds an array of shipment objects. If missing, add an error.
  if (!parsedData.mail_attachments) {
    errorSet.add("processShipments: No mail_attachments found in inputData.");
  } else {
    // Loop through each shipment in the mail attachments.
    const shipments = parsedData.mail_attachments;
    for (const shipment of shipments) {
      try {
        // Process the shipment. If errors occur during processing, they will be caught below.
        await processShipment(shipment);
      } catch (e) {
        // Log the full error immediately for debugging.
        console.error(e);
        // Add the error message to our error set to report later.
        errorSet.add(e.message);
      }
    }
  }

  // After processing all shipments, if any unique errors occurred,
  // aggregate them into a single message (each on a new line) and throw an error.
  if (errorSet.size > 0) {
    const combinedErrorMessage = Array.from(errorSet).join("\n");
    // Log the combined errors for further inspection.
    console.error("Accumulated Errors:\n", combinedErrorMessage);
    throw new Error(`processShipments encountered errors:\n${combinedErrorMessage}`);
  }

  // If no errors occurred, return success status.
  return { status: "successfully executed to the end" };
}

// Execute processShipments() and catch any unhandled error to surface it.
return processShipments().catch(error => {
  throw new Error(`Unhandled error:\n${error.message}`);
});
