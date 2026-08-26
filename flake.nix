{
  description = "Collie fork — mobile Herdr PWA (danieloakman/collie)";

  inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";

  outputs =
    { nixpkgs, ... }:
    let
      systems = [
        "x86_64-linux"
        "aarch64-linux"
        "aarch64-darwin"
        "x86_64-darwin"
      ];
      forAllSystems = nixpkgs.lib.genAttrs systems;
    in
    {
      devShells = forAllSystems (
        system:
        let
          pkgs = nixpkgs.legacyPackages.${system};
        in
        {
          default = pkgs.mkShell {
            packages = with pkgs; [
              bun
              git
              jq
              nodejs_22
            ];
            shellHook = ''
              echo "collie devShell — bun $(bun --version)"
              echo "  herdr plugin link \"\$(pwd)\"   # register this clone"
              echo "  bun run start / bun run web:dev / bun test"
            '';
          };
        }
      );
    };
}
