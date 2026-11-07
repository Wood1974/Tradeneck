# LiDAR check

Account tab, iPhone only. One test shot on the LiDAR camera that reports what depth information iOS gives Shield with a photo. It exists to learn what a real phone does before anything about depth is signed or sent.

## What it does
`DepthProbe.swift` stops the app's own camera session, runs its own one-shot session on the LiDAR depth camera (iOS 15.4+), asks for depth with the photo, converts the depth map to metres, and returns integers and short strings only: whether a LiDAR camera exists, whether depth delivery is supported, the map size, nearest/farthest/middle distance in millimetres, the percentage of points that have a distance, and iOS's own accuracy, quality and smoothing flags. The photo is dropped inside the function.

## What it does not do
It signs nothing, stores nothing and sends nothing, and the screen says so because that is how it is built. It does not touch the signed record: `depth_present` stays false and `depth_hash` is still never produced.

## Android
The method answers `android-not-supported`; the card is not shown there.

## Not verified
The Swift was written from Apple's API without a device or a Mac here; CI's iOS compile is the only check until a build is on an iPhone. Whether the wide-angle session or only the LiDAR device type delivers depth, and what the numbers look like indoors and outdoors, is exactly what running it on a Pro phone will show.

## What comes after (owner's decisions, not built)
Record a `depth_hash` in the signed record (the format already accepts it); whether the depth map ever leaves the phone; any "flat scene" flag. A flat-scene flag would be a signal, not proof: a compromised phone could supply its own depth.
