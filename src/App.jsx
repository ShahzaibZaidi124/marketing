import { Route, Routes, useLocation } from "react-router-dom";
import { useEffect } from "react";
import Header from "./components/Header.jsx";
import Footer from "./components/Footer.jsx";
import Home from "./pages/Home.jsx";
import Templates from "./pages/Templates.jsx";
import { About, Contact, Services } from "./pages/InfoPages.jsx";
import { NotFound, TemplateDetail } from "./pages/TemplateDetail.jsx";
import Demo from "./pages/Demo.jsx";
import Order from "./pages/Order.jsx";
import ExploreServices from "./pages/ExploreServices.jsx";
import ServiceDetails from "./pages/ServiceDetails.jsx";
import ServiceOrder from "./pages/ServiceOrder.jsx";

function ScrollToTop() {
  const { pathname, hash } = useLocation();
  useEffect(() => {
    if (hash) {
      document.getElementById(hash.slice(1))?.scrollIntoView({ behavior: "smooth" });
      return;
    }
    window.scrollTo({ top: 0, behavior: "instant" });
  }, [pathname, hash]);
  return null;
}

export default function App() {
  return (
    <>
      <ScrollToTop />
      <Header />
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/templates" element={<Templates />} />
        <Route path="/templates/:id" element={<TemplateDetail />} />
        <Route path="/demo/:id" element={<Demo />} />
        <Route path="/order/:id" element={<Order />} />
        <Route path="/services" element={<ExploreServices />} />
        <Route path="/services/:id/order" element={<ServiceOrder />} />
        <Route path="/services/:id" element={<ServiceDetails />} />
        <Route path="/studio-services" element={<Services />} />
        <Route path="/about" element={<About />} />
        <Route path="/contact" element={<Contact />} />
        <Route path="*" element={<NotFound />} />
      </Routes>
      <Footer />
    </>
  );
}
