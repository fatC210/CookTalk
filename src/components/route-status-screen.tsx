import { Link, useRouter } from "@tanstack/react-router";

type RouteStatusScreenProps = {
  title: string;
  body: string;
  primaryLabel: string;
  secondaryLabel: string;
  primaryAction?: () => void;
  secondaryHref?: string;
};

export function RouteStatusScreen({
  title,
  body,
  primaryLabel,
  secondaryLabel,
  primaryAction,
  secondaryHref = "/",
}: RouteStatusScreenProps) {
  return (
    <div className="min-h-screen bg-[linear-gradient(180deg,#f6f1e8_0%,#f8f4ee_100%)] p-3 sm:p-4">
      <div className="flex min-h-[calc(100vh-1.5rem)] items-center justify-center rounded-[28px] bg-[#fbf8f3] px-6 py-16 shadow-[inset_0_1px_0_rgba(255,255,255,0.75)] sm:min-h-[calc(100vh-2rem)]">
        <div className="mx-auto flex max-w-xl flex-col items-center text-center">
          <h1 className="font-display text-[2.1rem] font-semibold tracking-[-0.04em] text-[#2f251c] sm:text-[2.5rem]">
            {title}
          </h1>
          <p className="mt-4 max-w-lg text-base leading-8 text-[#7f7368] sm:text-[1.1rem]">
            {body}
          </p>
          <div className="mt-10 flex flex-wrap items-center justify-center gap-3">
            <button
              type="button"
              onClick={primaryAction}
              className="inline-flex min-w-[5.5rem] items-center justify-center rounded-[18px] bg-[#8a6a50] px-6 py-3 text-lg font-medium text-[#fffaf4] transition-transform duration-200 hover:-translate-y-0.5 hover:bg-[#7d5f47]"
            >
              {primaryLabel}
            </button>
            <Link
              to={secondaryHref}
              className="inline-flex min-w-[8.25rem] items-center justify-center rounded-[18px] border border-[#dacdbf] bg-transparent px-6 py-3 text-lg font-medium text-[#4a3d33] transition-colors duration-200 hover:bg-[#f4ede3]"
            >
              {secondaryLabel}
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}

export function RouteReloadErrorScreen(props: {
  title: string;
  body: string;
  primaryLabel: string;
  secondaryLabel: string;
  reset: () => void;
}) {
  const router = useRouter();

  return (
    <RouteStatusScreen
      title={props.title}
      body={props.body}
      primaryLabel={props.primaryLabel}
      secondaryLabel={props.secondaryLabel}
      primaryAction={() => {
        router.invalidate();
        props.reset();
      }}
    />
  );
}
