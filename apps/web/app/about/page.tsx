"use client";

import { MotionConfig } from "motion/react";
import { Features } from "@/components/marketing/features";
import { Hero } from "@/components/marketing/hero";
import { InstallSection } from "@/components/marketing/install-section";
import { MarketingFooter } from "@/components/marketing/marketing-footer";
import { MarketingNav } from "@/components/marketing/marketing-nav";
import { ProductShowcase } from "@/components/marketing/product-showcase";
import { SecuritySection } from "@/components/marketing/security-section";

// The product landing page remains public, independently of who is signed in.
export default function AboutPage() {
  return (
    <MotionConfig reducedMotion="user">
      <div className="flex min-h-full flex-col">
        <MarketingNav />
        <main id="main-content">
          <Hero />
          <ProductShowcase />
          <Features />
          <SecuritySection />
          <InstallSection />
        </main>
        <MarketingFooter />
      </div>
    </MotionConfig>
  );
}
