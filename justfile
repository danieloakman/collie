repo := justfile_directory()

default:
    @just --list

build:
    bash scripts/collie-ctl.sh build

link:
    herdr plugin action invoke restart --plugin herdr.collie
