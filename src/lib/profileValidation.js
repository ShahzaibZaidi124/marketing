const maxBioLength = 300;
const usernamePattern = /^[a-z0-9_]{3,20}$/;

function trimmedText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizedInterestList(value) {
  return trimmedText(value).split(/[,\n]/).map((item) => item.trim()).filter(Boolean).join(", ");
}

export function validateClientProfileDraft(profile) {
  const values = {
    fullName: trimmedText(profile.fullName),
    username: trimmedText(profile.username).toLowerCase(),
    country: trimmedText(profile.country),
    city: trimmedText(profile.city),
    bio: trimmedText(profile.bio),
    serviceInterests: normalizedInterestList(profile.serviceInterests),
    projectInterests: normalizedInterestList(profile.projectInterests),
  };
  const errors = {};

  if (!values.fullName) errors.fullName = "Enter your full name.";
  else if (values.fullName.length < 2) errors.fullName = "Full name must be at least 2 characters.";

  if (!values.username) errors.username = "Enter a username.";
  else if (!usernamePattern.test(values.username)) errors.username = "Use 3–20 letters, numbers, or underscores.";

  if (!values.country) errors.country = "Enter your country.";
  if (values.bio.length > maxBioLength) errors.bio = `Bio must be ${maxBioLength} characters or fewer.`;

  return { values, errors };
}
