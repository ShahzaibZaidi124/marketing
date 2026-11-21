function validPrice(value) {
  if (value === null || value === undefined || value === "") return null;
  const price = Number(value);
  return Number.isFinite(price) && price >= 0 ? price : null;
}

function validCurrency(value) {
  return typeof value === "string" && /^[A-Z]{3}$/.test(value);
}

export function resolveOrderCatalogSelection({
  service,
  packageId,
  servicePackage,
  activePackageExists = false,
}) {
  if (!service || service.is_active !== true) {
    return { value: null, status: 404, error: "This service is not currently available for orders." };
  }

  let packageName = null;
  let selectedPrice = service.base_price;
  let currency = service.currency;

  if (packageId) {
    if (!servicePackage
      || servicePackage.is_active !== true
      || servicePackage.service_id !== service.id) {
      return { value: null, status: 404, error: "This package is not available for the selected service." };
    }
    packageName = servicePackage.name;
    selectedPrice = servicePackage.price;
    currency = servicePackage.currency;
  } else if (activePackageExists) {
    return { value: null, status: 400, error: "Choose an available package before placing this order." };
  }

  const price = validPrice(selectedPrice);
  if (price === null || !validCurrency(currency)) {
    return { value: null, status: 400, error: "A valid price and currency are not available for this selection." };
  }

  return { value: { packageName, price, currency }, status: 200, error: "" };
}
