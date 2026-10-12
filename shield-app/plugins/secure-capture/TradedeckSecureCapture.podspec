require 'json'

package = JSON.parse(File.read(File.join(__dir__, 'package.json')))

Pod::Spec.new do |s|
  s.name = 'TradedeckSecureCapture'
  s.version = package['version']
  s.summary = 'TradeDeck Shield in-app capture and hardware seal'
  s.license = { :type => 'UNLICENSED' }
  s.homepage = 'https://tradedeckapp.com'
  s.author = 'TradeDeck'
  s.source = { :path => '.' }
  s.source_files = 'ios/Sources/**/*.{swift,h,m}'
  s.ios.deployment_target = '15.0'
  s.dependency 'Capacitor'
  s.swift_version = '5.0'
  s.frameworks = 'AVFoundation', 'CoreLocation', 'Security', 'UIKit'
end
