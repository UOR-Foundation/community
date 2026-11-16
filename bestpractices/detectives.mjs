/**
 * The badge application's own automated checks, as the pinned detective files
 * state them. Each rule names its detective file and a verbatim excerpt of it;
 * the projector finds the excerpt in the pinned file, cites its line, and
 * refuses to project when the excerpt is gone, so a rule cannot drift from the
 * Ruby it reads. Only the checks whose criterion names a file or fact of the
 * repository are taken; nothing the badge app infers from another criterion
 * (its mapping detectives) and nothing a human answers is restated here.
 *
 * A result is { value: 'Met' | 'Unmet', confidence } as the detective returns it
 * (CriterionStatus::MET / UNMET, confidence 1..5); a detective that returns
 * nothing for a field leaves it to the human, so the criterion stays unknown.
 */

// Regular expressions copied from the detectives; `source` is the Ruby text the projector looks for.
export const PATTERNS = {
  github: { re: /^https:\/\/github.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)\/?$/, file: 'app/lib/github_basic_detective.rb', source: '%r{\\Ahttps://github.com/([A-Za-z0-9_.-]+)/([A-Za-z0-9_.-]+)/?\\Z}' },
  contribution: { re: /^(contributing|contribute)(\.md|\.txt)?$/i, file: 'app/lib/repo_files_examine_detective.rb', source: '/\\A(contributing|contribute)(\\.md|\\.txt)?\\Z/i' },
  license: { re: /^([A-Za-z0-9]+-)?(license|copying)(\.md|\.txt)?$/i, file: 'app/lib/repo_files_examine_detective.rb', source: '/\\A([A-Za-z0-9]+-)?(license|copying)(\\.md|\\.txt)?\\Z/i' },
  licensesDir: { re: /^LICENSES$/, file: 'app/lib/repo_files_examine_detective.rb', source: '/\\ALICENSES\\Z/' },
  releaseNotes: { re: /^(changelog|news)(\.md|\.markdown|\.txt|\.html)?$/i, file: 'app/lib/repo_files_examine_detective.rb', source: '/\\A(changelog|news)(\\.md|\\.markdown|\\.txt|\\.html)?\\Z/i' },
  build: { re: /^(Makefile|GNUmakefile|autoconf.ac|automake.am|CMakeLists\.txt|Rakefile|pom\.xml|build\.xml|.*\.proj|build\.sbt|SConstruct|wscript)$/i, file: 'app/lib/build_detective.rb', source: 'Makefile|                 # Make' },
  docsFolder: { re: /^doc(s|umentation)?$/i, file: 'app/lib/subdir_file_contents_detective.rb', source: 'folder: /\\Adoc(s|umentation)?\\Z/i' },
  docsFile: { re: /(\.md|\.markdown|\.txt|\.html)?$/i, file: 'app/lib/subdir_file_contents_detective.rb', source: 'file: /(\\.md|\\.markdown|\\.txt|\\.html)?\\Z/i' },
  docsContents: { re: [/install(ation)?/i, /us(e|ing)/i, /secur(e|ity)/i], file: 'app/lib/subdir_file_contents_detective.rb', source: 'contents: [/install(ation)?/i, /us(e|ing)/i, /secur(e|ity)/i].freeze' },
  http: { re: /^http:\/\//i, file: 'app/lib/project_sites_https_detective.rb', source: 'HTTP_PATTERN = %r{\\Ahttp://}i' },
  https: { re: /^https:\/\//i, file: 'app/lib/project_sites_https_detective.rb', source: 'HTTPS_PATTERN = %r{\\Ahttps://}i' },
};
// The constants and literals each rule depends on, so that a change to any of them stops the projection.
export const ANCHORS = [
  ['app/lib/repo_files_examine_detective.rb', 'NONTRIVIAL_MIN_SIZE = 40'],
  ['app/lib/repo_files_examine_detective.rb', 'CONTRIBUTION_MIN_SIZE = 100'],
  ['app/lib/repo_files_examine_detective.rb', 'unmet_confidence = @top_level.nil? ? 1 : 5'],
  ['app/lib/repo_files_examine_detective.rb', 'def unmet_result(result_description, confidence: 1)'],
  ['app/lib/repo_files_examine_detective.rb', 'def met_result(result_description, html_url, confidence: 3)'],
  ['app/lib/build_detective.rb', "/ix, 'build'"],
  ['app/lib/build_detective.rb', '@results[:build_common_tools_status] = @results[:build_status]'],
  ['app/lib/subdir_file_contents_detective.rb', 'MAX_FILE_SIZE = 100_000'],
  ['app/lib/github_basic_detective.rb', "license_spdx_id.present? && license_spdx_id != 'NOASSERTION'"],
  ['app/lib/floss_license_detective.rb', "license = license.strip.chomp('+')"],
  ['app/lib/floss_license_detective.rb', 'elsif license.match?(/\\A[^(]/)'],
  ['app/lib/hardened_sites_detective.rb', 'content-security-policy strict-transport-security'],
  ['app/lib/hardened_sites_detective.rb', "headers['content-security-policy'].include?('frame-ancestors'))"],
  ['app/lib/hardened_sites_detective.rb', 'if homepage_url.present? && repo_url.present?'],
  ['app/lib/chief.rb', '(data[:confidence] <= result[field][:confidence])'],
  ['app/lib/chief.rb', 'CONFIDENCE_OVERRIDE = 4'],
];
// The files SecurityInsightsDetective and RepoJsonDetective read; their answers are the project's own and are not
// restated, so a repository carrying one is refused rather than evaluated without it.
export const SELF_DECLARED = ['security-insights.yml', 'SECURITY-INSIGHTS.yml', '.github/security-insights.yml', '.github/SECURITY-INSIGHTS.yml', '.bestpractices.json', '.project.d/bestpractices.json'];
export const SELF_DECLARED_ANCHORS = [
  ['app/lib/security_insights_detective.rb', 'SECURITY-INSIGHTS.yml'],
  ['app/lib/repo_json_detective.rb', "FILE_LOCATIONS = ['.bestpractices.json', '.project.d/bestpractices.json'].freeze"],
];
export const HEADERS = ['content-security-policy', 'strict-transport-security', 'x-content-type-options', 'x-frame-options'];

/** The OSI list FlossLicenseDetective compares with: the first parenthesized name of each entry of its array. */
export function osiLicenses(rubyText) {
  const start = rubyText.indexOf('OSI_LICENSES_FROM_OSI_WEBSITE = [');
  const end = rubyText.indexOf('].freeze', start);
  if (start < 0 || end < 0) throw new Error('floss_license_detective.rb has no OSI_LICENSES_FROM_OSI_WEBSITE array');
  // Ruby joins adjacent literals split by a backslash continuation.
  const body = rubyText.slice(start, end).replace(/'\s*\\\n\s*'/g, '');
  return [...body.matchAll(/'([^']*)'/g)].map((m) => m[1].match(/\(([^()]*)\)/)?.[1]).filter(Boolean);
}

/**
 * Every result the detectives give one repository, keyed by criterion field, before Chief merges them.
 * `facts` is the repository's snapshot record.
 */
export function detect(facts, osi) {
  const out = [];
  const put = (field, detective, value, confidence, evidence) => out.push({ field, detective, value, confidence, evidence });
  const repoUrl = `https://github.com/UOR-Foundation/${facts.name}`;
  const homepage = facts.homepage;
  const top = facts.topLevel;

  // GithubBasicDetective: a GitHub repository URL.
  if (PATTERNS.github.re.test(repoUrl)) {
    put('repo_public', 'github_basic', 'Met', 3, repoUrl);
    put('repo_track', 'github_basic', 'Met', 4, repoUrl);
    put('repo_distributed', 'github_basic', 'Met', 4, repoUrl);
    put('contribution', 'github_basic', 'Met', 2, repoUrl);
    put('discussion', 'github_basic', 'Met', 3, repoUrl);
  }
  // FlossLicenseDetective, on the license GithubBasicDetective reads from GitHub.
  const license = facts.licenseSpdx && facts.licenseSpdx !== 'NOASSERTION' ? facts.licenseSpdx.trim().replace(/\+$/, '') : '';
  if (license) {
    if (osi.some((l) => l.toLowerCase() === license.toLowerCase())) {
      put('floss_license_osi', 'floss_license', 'Met', 5, `GitHub license ${license}`);
      put('floss_license', 'floss_license', 'Met', 5, `GitHub license ${license}`);
    } else if (/^[^(]/.test(license)) {
      put('floss_license_osi', 'floss_license', 'Unmet', 1, `GitHub license ${license} is not on the detective's OSI list`);
    }
  }
  // RepoFilesExamineDetective and BuildDetective: the top-level listing.
  const named = (re, min) => top.filter((f) => f.type === 'file' && re.test(f.name) && f.size >= min);
  const files = (field, re, min, unmet) => {
    const hit = named(re, min);
    put(field, 'repo_files_examine', hit.length ? 'Met' : 'Unmet', hit.length ? 3 : unmet, hit.length ? hit[0].name : `no top-level file of ${min} bytes or more is named as the detective requires for ${field}`);
  };
  files('contribution', PATTERNS.contribution.re, 100, 1);
  files('license_location', PATTERNS.license.re, 40, 5);
  const licensesDir = top.find((f) => f.type === 'dir' && PATTERNS.licensesDir.re.test(f.name));
  if (licensesDir) {
    const at = out.findIndex((r) => r.field === 'license_location');
    out[at] = { ...out[at], value: 'Met', confidence: 3, evidence: 'LICENSES/' };
  }
  files('release_notes', PATTERNS.releaseNotes.re, 40, 1);
  const build = top.filter((f) => f.type === 'file' && PATTERNS.build.re.test(f.name));
  if (build.length) {
    put('build', 'build', 'Met', 3, build[0].name);
    put('build_common_tools', 'build', 'Met', 3, build[0].name);
  }
  // SubdirFileContentsDetective: the first top-level documentation folder and its files' contents.
  if (!facts.docs) put('documentation_basics', 'subdir_file_contents', 'Unmet', 3, 'no top-level doc, docs or documentation folder');
  else {
    const hit = facts.docs.files.find((f) => f.type === 'file' && PATTERNS.docsFile.re.test(f.name) && f.read && f.contents.some(Boolean));
    put('documentation_basics', 'subdir_file_contents', hit ? 'Met' : 'Unmet', hit ? 3 : 1, hit ? `${facts.docs.folder}/${hit.name}` : `no file of ${facts.docs.folder}/ mentions install, use or security`);
  }
  // ProjectSitesHttpsDetective: the project and repository URLs.
  if (PATTERNS.http.re.test(homepage) || PATTERNS.http.re.test(repoUrl)) put('sites_https', 'project_sites_https', 'Unmet', 5, `${homepage || repoUrl} uses http`);
  else if ((homepage || repoUrl) && (PATTERNS.https.re.test(homepage) || PATTERNS.https.re.test(repoUrl))) put('sites_https', 'project_sites_https', 'Met', 3, [homepage, repoUrl].filter(Boolean).join(' '));
  // HardenedSitesDetective: both URLs, and the headers of each final response.
  if (homepage && repoUrl) {
    const problems = facts.headers.flatMap((h) => {
      const missing = ['content-security-policy', 'strict-transport-security', 'x-content-type-options'].filter((k) => !h.present.includes(k));
      if (!(h.present.includes('x-frame-options') || h.frameAncestors)) missing.push('x-frame-options');
      return missing.length ? [`${h.url}: ${missing.join(', ')}`] : [];
    });
    put('hardened_site', 'hardened_sites', problems.length ? 'Unmet' : 'Met', problems.length ? 5 : 3, problems.length ? problems.join('; ') : 'every required header is sent');
  }
  return out;
}

/** Chief.merge_changeset: per field the highest confidence wins, and the earlier result wins a tie. */
export function merge(results) {
  const best = new Map();
  for (const r of results) {
    const had = best.get(r.field);
    if (had && r.confidence <= had.confidence) continue;
    best.set(r.field, r);
  }
  return best;
}
