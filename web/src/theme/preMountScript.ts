// Source of truth for the pre-mount theme resolver. The contents of
// `PRE_MOUNT_THEME_SCRIPT` must be copied verbatim into the inline
// <script> in web/index.html. A test in Task 5 asserts they stay in
// sync.

export const STORAGE_KEY = 'home-ergo:theme'

// Written as a plain string (not a function reference) so it can be
// inlined into index.html. Resolution order:
//   1. localStorage override (ThemeKind = 'dark' | 'light' | 'system')
//   2. prefers-color-scheme
//   3. Default: dark
export const PRE_MOUNT_THEME_SCRIPT = `(function(){
  try {
    var stored = localStorage.getItem('home-ergo:theme');
    var resolved = 'dark';
    if (stored === 'light' || stored === 'dark') {
      resolved = stored;
    } else {
      var mql = window.matchMedia('(prefers-color-scheme: light)');
      if (mql && mql.matches) resolved = 'light';
    }
    document.documentElement.setAttribute('data-theme', resolved);
  } catch (e) {
    document.documentElement.setAttribute('data-theme', 'dark');
  }
})();`
