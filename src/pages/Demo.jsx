import { ArrowLeft, ArrowUpRight, ExternalLink, MoveUpRight } from "lucide-react";
import { Link, useParams } from "react-router-dom";
import { templates } from "../data/templates.js";

export default function Demo() {
  const { id } = useParams();
  const template = templates.find((item) => item.id === id);
  if (!template) return <main className="simple-page"><h1>Demo not found</h1><Link to="/templates">Back to templates</Link></main>;

  return (
    <main className="demo-page section">
      <div className="demo-toolbar"><Link to={`/templates/${template.id}`} className="back-link"><ArrowLeft size={14} /> Back to {template.name}</Link><span className="demo-badge"><span /> TEMPLATE PREVIEW</span><Link to={`/order/${template.id}`} className="button button-small button-light">Make it yours <ArrowUpRight size={14} /></Link></div>
      <div className={`demo-browser template-art-${template.style}`}>
        <div className="browser-chrome"><span className="browser-dots"><i /><i /><i /></span><span className="browser-address">{template.name.toLowerCase().replaceAll(" ", "")}.nextech.pk</span><ExternalLink size={13} /></div>
        <div className="demo-content">
          <nav className="demo-nav"><span className="demo-logo"><span />{template.name.split(" ")[0].toLowerCase()}</span><span>Work&nbsp;&nbsp;&nbsp; About&nbsp;&nbsp;&nbsp; Journal</span><span className="demo-cta">LET’S TALK <MoveUpRight size={12} /></span></nav>
          <div className="demo-main"><span className="mini-overline">A LITTLE DIFFERENT, BY DESIGN</span><h1>{demoHeadings[template.style]}</h1><p>Good ideas deserve a little room to become what they could be.</p><Link to={`/order/${template.id}`} className="demo-link">EXPLORE THE POSSIBILITIES <ArrowUpRight size={13} /></Link></div>
          <div className="demo-decoration"><span /><i /><i /></div>
          <div className="demo-bottomline"><span>INDEPENDENT BY NATURE.</span><span>01 — {String(template.pages).padStart(2, "0")}</span></div>
        </div>
      </div>
      <p className="demo-disclaimer">A live look at <strong>{template.name}</strong>, made with intention by NexTech.</p>
    </main>
  );
}

const demoHeadings = {
  nimbus: "Make the future useful.",
  layer: "Work flows better here.",
  forma: "Everyday, reconsidered.",
  monogram: "An archive of good ideas.",
  orbit: "Good ideas move people.",
  synth: "A clearer way to build.",
};
