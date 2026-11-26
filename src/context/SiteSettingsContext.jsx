import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { defaultPlatformSettings, getPublicSiteSettings } from "../lib/platformSettings.js";

// Loads the public platform settings once for the whole app and exposes them to
// the website chrome (header, footer, contact page). Only the four non-sensitive
// display values are read, and they already fall back to the shipped defaults, so
// a missing migration or an offline backend never blanks the site.
const SiteSettingsContext = createContext(null);

export function SiteSettingsProvider({ children }) {
  const [settings, setSettings] = useState(defaultPlatformSettings);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    setLoading(true);

    getPublicSiteSettings()
      .then((loaded) => { if (active) setSettings(loaded); })
      .catch(() => { if (active) setSettings({ ...defaultPlatformSettings }); })
      .finally(() => { if (active) setLoading(false); });

    return () => { active = false; };
  }, []);

  const value = useMemo(() => ({ settings, loading }), [settings, loading]);

  return <SiteSettingsContext.Provider value={value}>{children}</SiteSettingsContext.Provider>;
}

export function useSiteSettings() {
  const context = useContext(SiteSettingsContext);
  if (!context) throw new Error("useSiteSettings must be used within a SiteSettingsProvider.");
  return context;
}
