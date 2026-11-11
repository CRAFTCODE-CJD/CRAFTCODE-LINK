// Replace the pinned Electron distribution's application resources before distributing.
import fs from 'node:fs/promises';
import { NtExecutable, NtExecutableResource, Data, Resource } from 'resedit';
export async function brandWindows(file, iconFile, version) {
  const exe = NtExecutable.from(await fs.readFile(file), {ignoreCert:true});
  const resources = NtExecutableResource.from(exe);
  const icons = Data.IconFile.from(await fs.readFile(iconFile)).icons.map(i=>i.data);
  const groups = Resource.IconGroupEntry.fromEntries(resources.entries);
  const versions = Resource.VersionInfo.fromEntries(resources.entries);
  if (!groups.length || !versions.length) throw new Error('Missing Windows icon or version resource.');
  for (const group of groups) Resource.IconGroupEntry.replaceIconsForResource(resources.entries,group.id,group.lang,icons);
  for (const info of versions) {
    for (const lang of info.getAllLanguagesForStringValues()) {
      info.setProductVersion(version,lang.lang); info.setFileVersion(version,lang.lang);
      info.setStringValues(lang,{ProductName:'CRAFTCODE LINK',FileDescription:'CRAFTCODE LINK',CompanyName:'CRAFTCODE',
        OriginalFilename:'CRAFTCODE-LINK.exe',InternalName:'CRAFTCODE LINK'});
    }
    info.outputToResourceEntries(resources.entries);
  }
  resources.outputResource(exe);
  await fs.writeFile(file,Buffer.from(exe.generate()));
}
