export const categories = [
  "All templates",
  "SaaS",
  "AI & tech",
  "E-commerce",
  "Agency",
  "Portfolio",
];

export const templates = [
  {
    id: "nimbus",
    name: "Nimbus AI",
    category: "AI & tech",
    price: 12500,
    rating: "4.9",
    reviews: 28,
    description:
      "A confident, conversion-minded home for the next generation of AI tools.",
    tag: "Bestseller",
    style: "nimbus",
    initials: "N",
    pages: 8,
    features: ["AI product landing page", "Pricing & plan comparison", "Feature showcase", "Responsive layouts"],
  },
  {
    id: "layer",
    name: "Layer Studio",
    category: "SaaS",
    price: 9800,
    rating: "4.8",
    reviews: 19,
    description:
      "A considered SaaS starter built for products that make work feel lighter.",
    tag: "Popular",
    style: "layer",
    initials: "L",
    pages: 7,
    features: ["SaaS marketing pages", "Product dashboard preview", "Customer stories", "Pricing page"],
  },
  {
    id: "forma",
    name: "Forma Goods",
    category: "E-commerce",
    price: 14900,
    rating: "5.0",
    reviews: 14,
    description:
      "A warm, editorial storefront for thoughtful products and independent brands.",
    tag: "New",
    style: "forma",
    initials: "F",
    pages: 10,
    features: ["Editorial storefront", "Product detail pages", "Collection layouts", "Cart-ready design"],
  },
  {
    id: "monogram",
    name: "Monogram",
    category: "Portfolio",
    price: 7500,
    rating: "4.9",
    reviews: 32,
    description:
      "A quiet, beautifully considered portfolio that lets the work do the talking.",
    tag: "",
    style: "monogram",
    initials: "M",
    pages: 5,
    features: ["Project-led home page", "Case study layouts", "About & contact pages", "Elegant typography"],
  },
  {
    id: "orbit",
    name: "Orbit Digital",
    category: "Agency",
    price: 11900,
    rating: "4.7",
    reviews: 17,
    description:
      "A bright, big-thinking home for independent creative and digital studios.",
    tag: "Trending",
    style: "orbit",
    initials: "O",
    pages: 8,
    features: ["Agency service pages", "Case study layouts", "People & process", "Project enquiry form"],
  },
  {
    id: "synth",
    name: "Synth Labs",
    category: "SaaS",
    price: 10900,
    rating: "4.9",
    reviews: 21,
    description:
      "Make a sharp first impression with a crisp, product-first SaaS website.",
    tag: "",
    style: "synth",
    initials: "S",
    pages: 6,
    features: ["Product-led landing page", "Clear feature sections", "Pricing layouts", "Resource library"],
  },
];

export const formatPrice = (price) =>
  `Rs. ${new Intl.NumberFormat("en-PK").format(price)}`;
