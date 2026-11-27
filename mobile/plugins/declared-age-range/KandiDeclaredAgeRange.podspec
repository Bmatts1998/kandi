require 'json'

package = JSON.parse(File.read(File.join(__dir__, 'package.json')))

Pod::Spec.new do |s|
  s.name = 'KandiDeclaredAgeRange'
  s.version = package['version']
  s.summary = 'Apple Declared Age Range for Kandi'
  s.license = 'MIT'
  s.homepage = 'https://github.com/Bmatts1998/kandi'
  s.author = 'Kandi'
  s.source = { :git => 'https://github.com/Bmatts1998/kandi.git', :tag => s.version.to_s }
  s.source_files = 'ios/Sources/**/*.{swift,h,m,c,cc,mm,cpp}'
  s.ios.deployment_target = '14.0'
  s.dependency 'Capacitor'
  s.swift_version = '5.1'
end
