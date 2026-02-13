import { redirect } from 'next/navigation'

export default function CharacterRedirect() {
  redirect('/admin/audio?tab=character')
}
