// Country flags from the flag-icons package. Vite emits each SVG as its own
// asset, so only the flags actually shown are downloaded.

const urls = import.meta.glob<string>("../node_modules/flag-icons/flags/4x3/*.svg", {
  query: "?url",
  import: "default",
  eager: true,
});

const byIso2 = new Map(
  Object.entries(urls).map(([path, url]) => [path.slice(path.lastIndexOf("/") + 1, -4).toUpperCase(), url]),
);

export const flagUrl = (iso2: string) => byIso2.get(iso2.toUpperCase());

export function Flag({ iso2, name }: { iso2: string; name: string }) {
  const url = byIso2.get(iso2.toUpperCase());
  if (!url) return <span class="flag flag-text" title={name}>{iso2}</span>;
  return <img class="flag" src={url} alt={name} title={name} width={18} height={13.5} loading="lazy" />;
}
