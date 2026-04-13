{
  description = "Support – GitHub-backed issue tracking packages";

  inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixpkgs-unstable";

  outputs = {
    self,
    nixpkgs,
  }: let
    inherit (nixpkgs) lib;
    supportedSystems = [
      "x86_64-linux"
      "aarch64-linux"
      "aarch64-darwin"
    ];

    forEachSupportedSystem = f:
      lib.genAttrs supportedSystems (
        system:
          f {
            pkgs = import nixpkgs {
              inherit system;
              overlays = [
                (final: prev: {
                  bun = prev.bun.overrideAttrs rec {
                    __intentionallyOverridingVersion = true;
                    version = "1.3.9";
                    passthru.sources.aarch64-linux = prev.fetchurl {
                      url = "https://github.com/oven-sh/bun/releases/download/bun-v${version}/bun-linux-aarch64.zip";
                      hash = "sha256-osKGK8wf0cCzqNzcjH77XirNhx6yDtLxdheITt6ByEQ=";
                    };
                    passthru.sources.aarch64-darwin = prev.fetchurl {
                      url = "https://github.com/oven-sh/bun/releases/download/bun-v${version}/bun-darwin-aarch64.zip";
                      hash = "sha256-zeak7fGc9kkJFY+lpGShICb9fw15pKlQwQzwrwQmbYU=";
                    };
                  };
                })
              ];
            };
          }
      );
  in {
    devShells = forEachSupportedSystem (
      {pkgs}:
        with pkgs; {
          default = mkShell {
            packages = [
              # web
              bun
              biome
              typescript-go
              gh

              # nix
              nixd
              alejandra
            ];

            shellHook = ''
              echo "support: installing deps"
              bun install --silent
            '';
          };
        }
    );
  };
}
