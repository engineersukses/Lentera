// Sembunyikan jendela konsol di Windows saat build release.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    lentera_lib::run()
}
