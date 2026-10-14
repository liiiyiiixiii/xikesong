import Image from "next/image";

/** Shared transparent enterprise mark for every application surface. */
export default function BrandLogo() {
  return <Image className="scale-brand-logo" src="/brand/koala-farm.png" alt="红考拉 KaolaFarm" width={1983} height={793} unoptimized priority />;
}
