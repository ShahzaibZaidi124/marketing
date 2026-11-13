import React from "react";
import { ArrowRight, ArrowUpRight, Compass, Layers3, Mail, MessageCircle, PenTool, Sparkles, Target, WandSparkles } from "lucide-react";
import { Link } from "react-router-dom";

const serviceList = [
  { Icon: PenTool, num: "01", title: "Digital experiences", text: "Custom-designed websites that make your idea feel entirely your own. Thoughtful strategy, original design, and the details that make it memorable." },
  { Icon: Layers3, num: "02", title: "Brand & identity", text: "A clear point of view, captured in a visual identity built to go wherever your next idea takes you." },
  { Icon: WandSparkles, num: "03", title: "Something a little different", text: "Have a specific challenge in mind? Tell us a little about it and we’ll find the right way to help." },
];

export function Services() {
  return (
    <main>
      <section className="page-hero info-hero"><div className="section-topline"><span>THOUGHTFUL WORK, GOOD PEOPLE</span><span>01 / WHAT WE DO</span></div><div className="page-hero-content"><span className="eyebrow"><Sparkles size={13} /> A little more hands-on</span><h1>For the ideas that<br /><span className="gradient-text">need their own thing.</span></h1><p>Some ideas deserve a beginning that’s made just for them.<br className="desktop-break" /> We’d love to hear what you have in mind.</p></div><div className="page-hero-bottom"><span>GOOD WORK STARTS WITH GOOD CONVERSATION</span><Link to="/contact">TELL US YOUR IDEA <ArrowUpRight size={12} /></Link></div></section>
      <section className="section offerings-section"><div className="section-heading-row compact-heading"><div><span className="eyebrow">Here’s where we can help</span><h2>Good work, thoughtfully made.</h2></div><p>A small, independent studio means you work with the people making the work. On purpose.</p></div><div className="offerings-grid">{serviceList.map(({ Icon, num, title, text }) => <article className="offering-card" key={num}><div className="offering-top"><span>{num} / THREE WAYS TO BEGIN</span><Icon size={20} /></div><div className="offering-bottom"><h3>{title}</h3><p>{text}</p><Link to="/contact" aria-label={`Ask us about ${title}`}><ArrowUpRight size={15} /></Link></div></article>)}</div></section>
      <section className="info-cta"><span className="eyebrow">The best place to start is a conversation</span><h2>Tell us the little bit<br />you already know.</h2><Link className="button button-primary" to="/contact">Let’s talk about it <ArrowRight size={15} /></Link></section>
    </main>
  );
}

export function About() {
  return (
    <main>
      <section className="page-hero info-hero about-hero"><div className="section-topline"><span>INDEPENDENT BY NATURE</span><span>01 / A LITTLE ABOUT US</span></div><div className="page-hero-content"><span className="eyebrow"><Compass size={13} /> A small note from our studio</span><h1>We think good things<br /><span className="gradient-text">deserve good beginnings.</span></h1><p>We’re TechStudio. A little creative studio from Lahore, Pakistan,<br className="desktop-break" /> with a soft spot for people making things happen.</p></div><div className="page-hero-bottom"><span>MADE WITH INTENTION, ALWAYS</span><span>LAHORE · EVERYWHERE</span></div></section>
      <section className="about-story section"><div className="story-index"><span>01 — THE IDEA</span><Sparkles size={17} /></div><div className="story-copy"><h2>It’s hard to make something new when you’re still figuring out where to begin.</h2><p>We’ve seen brilliant ideas get buried under the busywork. The blank pages, the endless decisions, the starting-over-again. So we made a more considered place to start.</p><p>TechStudio is a little independent studio and marketplace built for people with somewhere to go. Thoughtful website templates for the quicker beginning — and a real creative team to call on when your idea needs something more.</p><Link className="text-link" to="/templates">Find something to build on <ArrowUpRight size={14} /></Link></div></section>
      <section className="about-values"><div className="section values-inner"><span className="eyebrow">A few things we believe</span><div className="values-grid"><div><Target size={19} /><h3>Good design means something.</h3><p>Not more decoration. Just a little more thought in all the right places.</p></div><div><Sparkles size={19} /><h3>The details are the whole thing.</h3><p>Care shows up in the small things — and people can always feel it.</p></div><div><MessageCircle size={19} /><h3>Work works better together.</h3><p>We believe good work starts with a good, honest conversation.</p></div></div></div></section>
      <section className="info-cta"><span className="eyebrow">There’s always room for another good idea</span><h2>Let’s see what you’re making.</h2><Link className="button button-primary" to="/contact">Come say hello <ArrowRight size={15} /></Link></section>
    </main>
  );
}

export function Contact() {
  return (
    <main className="contact-page section">
      <div className="section-topline"><span>ALWAYS ROOM FOR ANOTHER GOOD IDEA</span><span>01 / COME SAY HELLO</span></div>
      <div className="contact-layout"><div className="contact-copy"><span className="eyebrow"><Mail size={13} /> A good conversation starts anywhere</span><h1>Tell us what’s<br /><span className="gradient-text">on your mind.</span></h1><p>A project, a question, a half-formed idea. There’s no wrong way to say hello.</p><a className="contact-email" href="mailto:hello@techstudio.pk">hello@techstudio.pk <ArrowUpRight size={17} /></a><div className="contact-location"><span>OUR STUDIO</span><span>Lahore, Pakistan<br />A little everywhere, too.</span></div></div>
        <ContactForm />
      </div>
    </main>
  );
}

function ContactForm() {
  const [sent, setSent] = React.useState(false);
  const [error, setError] = React.useState("");
  function submit(event) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const name = String(data.get("name") || "").trim();
    const email = String(data.get("email") || "").trim();
    const message = String(data.get("message") || "").trim();
    if (!name || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !message) {
      setError("Please add your name, a valid email address and a short message.");
      return;
    }
    setError("");
    setSent(true);
  }
  if (sent) return <div className="contact-success"><span className="success-icon"><Sparkles size={23} /></span><span className="eyebrow">Demo preview · nothing was sent</span><h2>Your note wasn’t delivered.</h2><p>This site has no contact backend. Your details were not sent or saved; email TechStudio directly if you want to reach someone.</p><a className="text-link" href="mailto:hello@techstudio.pk">Email TechStudio <ArrowUpRight size={14} /></a></div>;
  return <form className="contact-form" onSubmit={submit} noValidate><span className="eyebrow">A little more about it</span><label htmlFor="contact-name">Your name</label><input id="contact-name" name="name" placeholder="The name we should use" autoComplete="name" /><label htmlFor="contact-email">Email address</label><input id="contact-email" name="email" type="email" placeholder="you@somewhere.com" autoComplete="email" /><label htmlFor="contact-message">What’s on your mind?</label><textarea id="contact-message" name="message" rows="5" placeholder="Start wherever feels right..." />{error && <span className="form-error" role="alert">{error}</span>}<button className="button button-primary" type="submit">Preview note <ArrowRight size={15} /></button><span className="contact-form-note">Demo only. Nothing is sent or saved; don’t include sensitive information.</span></form>;
}
