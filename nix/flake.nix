{
  description = "Local ascii-art development environment";

  inputs.nixpkgs.url = "https://channels.nixos.org/nixpkgs-unstable/nixexprs.tar.zst";

  outputs =
    { nixpkgs, ... }:
    let
      pkgs = import nixpkgs { system = "x86_64-linux"; };
      python = pkgs.python3.withPackages (
        ps: with ps; [
          numpy
          scipy
          pillow
          scikit-image
          playwright
          fastapi
          uvicorn
          httpx
        ]
      );
    in
    {
      devShells.x86_64-linux.default = pkgs.mkShellNoCC {
        packages = [
          python
          pkgs.ffmpeg
        ];
        PLAYWRIGHT_BROWSERS_PATH = pkgs.python3Packages.playwright.driver.browsers.override {
          withChromium = false;
          withFirefox = false;
          withWebkit = false;
          withFfmpeg = false;
        };
        PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD = "1";
      };
    };
}
