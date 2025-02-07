require('dotenv').config();

const testing = 'true';
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

  // Test each variation of the SKU against each order item.
  let matched = false;
  for (const itemInOrder of orderData.line_items) {
    const orderSkuVariants = getSkuVariants(itemInOrder.final_sku);
    // Check if any variant of the shipment SKU matches any variant of the order SKU.
    const found = shipmentVariants.some(skuVar => orderSkuVariants.includes(skuVar));
    if (found) {
      matched = true;
      const updateOrderPayload = JSON.stringify({
        shipment: {
          tracking_number: shipment.tracking_number,
          send_shipping_confirmation: true,
          ship_date: shipment.shipment_date,
          note: "Updated Via Edwards Shipment Doc Through Centricity API",
          shipping_method: mappedShippingMethod,
          line_items: [
            {
              id: itemInOrder.id,
              quantity: Math.round(Number(shipment.item_qty)),
            },
          ],
        },
      });
      await updateOrder(
        orderId,
        storeUrl,
        apiKey,
        updateOrderPayload,
        itemInOrder.id,
        shipment.tracking_number
      );
    }
  }
  if (!matched) {
    throw new Error(
      `processShipment: No matching SKU found for shipment with SKU variations: ${shipmentVariants.join(" | ")}`
    );
  }
}

// Process all shipments sequentially and accumulate errors.
async function processShipments() {
  // Use a Set to deduplicate error messages.
  const errorSet = new Set();
  let parsedData;

  if (testing) {
    // In testing mode, assume inputData is already an object.
    parsedData = inputData;
  } else {
    try {
      parsedData = JSON.parse(inputData.mailparser);
    } catch (e) {
      throw new Error(`processShipments: Error parsing inputData.mailparser - ${e.message}`);
    }
  }

  if (!parsedData.mail_attachments) {
    errorSet.add("processShipments: No mail_attachments found in inputData.");
  } else {
    const shipments = parsedData.mail_attachments;
    for (const shipment of shipments) {
      try {
        await processShipment(shipment);
      } catch (e) {
        // Log full error immediately.
        console.error(e);
        errorSet.add(e.message);
      }
    }
  }

  // If errors occurred, aggregate them (each on a new line) and throw one error.
  if (errorSet.size > 0) {
    const combinedErrorMessage = Array.from(errorSet).join("\n");
    console.error("Accumulated Errors:\n", combinedErrorMessage);
    throw new Error(`processShipments encountered errors:\n${combinedErrorMessage}`);
  }

  return { status: "successfully executed to the end" };
}

// Execute and wrap the async call so that Zapier (or Node) receives the error if any occur.
return processShipments().catch(error => {
  throw new Error(`Unhandled error:\n${error.message}`);
});
