import { ArrowDown, ArrowRight, Check, Mail, MoveUpRight } from "lucide-react";

const capabilities = [
  { number: "01", title: "提花面料", en: "JACQUARD", text: "以组织结构塑造图案与触感，支持几何、肌理与品牌定制开发。" },
  { number: "02", title: "朱地面料", en: "PIQUÉ", text: "清晰珠地纹理兼顾透气与挺括，适用于 Polo、校服与日常服饰。" },
  { number: "03", title: "运动面料", en: "PERFORMANCE", text: "围绕吸湿速干、弹力与轻量需求，为运动场景开发稳定面料方案。" },
];

const process = ["需求与用途确认", "纱线及组织设计", "试样与性能确认", "量产与品质追踪"];

export default function Home() {
  return (
    <main>
      <header className="site-header">
        <a className="brand" href="#top" aria-label="LYJ Textile 首页"><span className="brand-mark">LYJ</span><span>TEXTILE</span></a>
        <nav aria-label="主要导航"><a href="#products">产品</a><a href="#craft">制造</a><a href="#process">合作流程</a><a href="#about">关于我们</a></nav>
        <a className="header-cta" href="mailto:hello@lyj-textile.com">联系询样 <ArrowRight size={14} /></a>
      </header>

      <section id="top" className="hero dark-stage">
        <img src="/images/knitting-machine.jpg" alt="LYJ 纺织工厂圆机生产现场" />
        <div className="hero-shade" />
        <div className="hero-copy">
          <p className="eyebrow">针织面料制造 · 中国</p>
          <h1>让每一根纱线，<br />成为产品的一部分。</h1>
          <p className="hero-lede">专注提花、朱地与运动面料。从组织开发到稳定量产，为服装品牌提供清晰、可靠的面料解决方案。</p>
          <div className="hero-actions"><a className="button primary" href="mailto:hello@lyj-textile.com">获取样品 <ArrowRight size={16} /></a><a className="text-link light" href="#products">探索产品 <ArrowDown size={15} /></a></div>
        </div>
        <div className="hero-index"><span>LYJ / 01</span><span>结构 · 手感 · 性能</span></div>
      </section>

      <section id="products" className="products section dark-stage">
        <div className="section-intro"><p className="kicker">核心产品</p><h2>三类面料，回应不同的穿着需求。</h2></div>
        <div className="product-list">
          {capabilities.map((item) => <article className="product-row" key={item.number}><span className="product-number">{item.number}</span><div><span className="product-en">{item.en}</span><h3>{item.title}</h3></div><p>{item.text}</p><span className="round-icon" aria-hidden="true"><MoveUpRight size={22} /></span></article>)}
        </div>
      </section>

      <section id="craft" className="feature dark-stage">
        <div className="feature-card"><img src="/images/knitting-detail.jpg" alt="针织设备运行中的纱线细节" /><div className="feature-overlay" /><div className="feature-copy"><p className="kicker">制造现场</p><h2>把复杂的组织，织成稳定的日常。</h2><p>从张力、密度到布面状态，关键参数在生产过程中持续校准。我们关心的不只是样品效果，更是每一批大货的一致性。</p></div></div>
      </section>

      <section id="process" className="process section light-stage">
        <div className="process-heading"><p className="kicker orange">开发协作</p><h2>从一个想法，<br />到一匹可交付的布。</h2></div>
        <div className="process-content"><p className="lead">根据用途、克重、手感与功能目标共同定义面料。我们以样品为沟通语言，让开发路径更短，让结果更确定。</p><ol>{process.map((item, index) => <li key={item}><span>0{index + 1}</span>{item}<Check size={18} /></li>)}</ol></div>
      </section>

      <section id="about" className="story light-stage">
        <div className="story-image"><img src="/images/yarn-line.jpg" alt="工厂纱线供应与张力控制系统" /></div>
        <div className="story-copy"><p className="kicker orange">关于 LYJ</p><h2>懂设备，也懂成衣最终需要什么。</h2><p>我们是一家聚焦针织面料的制造企业，以扎实的生产经验服务服装品牌、贸易伙伴与成衣工厂。团队把结构开发、生产控制与交付响应放在同一条线上，让创意真正落到布面。</p><div className="facts"><div><strong>3</strong><span>核心面料方向</span></div><div><strong>4</strong><span>开发协作阶段</span></div><div><strong>100%</strong><span>批次过程追踪</span></div></div></div>
      </section>

      <section className="contact dark-stage"><p className="kicker">开始合作</p><h2>把下一块面料，<br />做得更准确。</h2><p>告诉我们产品用途、目标手感或参考样，我们会从适合的组织和纱线方案开始。</p><a className="button primary" href="mailto:hello@lyj-textile.com"><Mail size={16} /> 联系询样</a><span className="placeholder-note">邮箱、电话与地址可在确认后替换</span></section>
      <footer><div className="brand footer-brand"><span className="brand-mark">LYJ</span><span>TEXTILE</span></div><p>提花 · 朱地 · 运动面料</p><p>© {new Date().getFullYear()} LYJ Textile</p></footer>
    </main>
  );
}
