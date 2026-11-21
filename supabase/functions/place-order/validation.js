function readTrimmedString(value, maximumLength) {
  if (typeof value !== "string") return "";
  const trimmed = value.trim();
  return trimmed.length <= maximumLength ? trimmed : "";
}

export function parsePlaceOrderBody(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { value: null, error: "The order request is invalid." };
  }

  const serviceId = readTrimmedString(body.service_id, 120);
  const packageId = body.package_id === null || body.package_id === undefined
    ? null
    : readTrimmedString(body.package_id, 120);
  const projectName = readTrimmedString(body.project_name, 120);
  const orderDescription = readTrimmedString(body.order_description, 5000);
  const requirements = body.requirements === undefined
    ? ""
    : readTrimmedString(body.requirements, 10000);

  if (!/^[a-zA-Z0-9_-]{1,120}$/.test(serviceId)
    || (packageId !== null && !/^[a-zA-Z0-9_-]{1,120}$/.test(packageId))) {
    return { value: null, error: "Choose an available service and package." };
  }
  if (!projectName || !orderDescription
    || (body.requirements !== undefined && typeof body.requirements !== "string")
    || (typeof body.requirements === "string" && body.requirements.trim().length > 10000)) {
    return {
      value: null,
      error: "Enter a project name and order description. Requirements must be 10,000 characters or fewer.",
    };
  }

  return {
    value: { serviceId, packageId, projectName, orderDescription, requirements },
    error: "",
  };
}
